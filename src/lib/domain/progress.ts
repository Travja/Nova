import { periodFor, recentPeriods, type Period, type PeriodOptions } from './period';
import { cadenceOf } from './tiers';
import type { Goal, MetricDefinition, ProgressEntry } from './types';

/**
 * Progress maths. Every function here is pure so the same numbers can be
 * computed on the server for the dashboard payload and in the browser when an
 * entry is logged optimistically.
 */

export interface Orbit {
	period: Period;
	/** Total logged within the period. */
	logged: number;
	target: number;
	/** logged / target, uncapped — 1.4 means the orbit closed with room to spare. */
	ratio: number;
	/** Ratio clamped to 0-1, for drawing the arc. */
	fraction: number;
	/** Where the body sits on its ring, in degrees clockwise from the top. */
	angle: number;
	complete: boolean;
	/** How much is still needed to close the orbit. Zero once complete. */
	remaining: number;
	/** The goal was archived for the whole of this period, so it never flew. */
	dormant: boolean;
}

/**
 * A span during which a goal was archived. Orbits that fall wholly inside one
 * are skipped by the streak maths — archiving freezes a streak rather than
 * breaking it, so restoring a goal picks up where it left off.
 */
export interface DormantWindow {
	from: Date;
	/** Null while the goal is still archived. */
	until: Date | null;
}

export interface GoalSnapshot {
	goal: Goal;
	current: Orbit;
	/** Most recent orbits, newest first, including the in-flight one. */
	history: Orbit[];
	/** Consecutive closed orbits ending at the last closed one. */
	streak: number;
	/** Every orbit ever closed for this goal. */
	totalOrbits: number;
	/** Lifetime total logged, in the metric's units. */
	lifetimeLogged: number;
}

type EntryLike = Pick<ProgressEntry, 'amount' | 'occurredAt'>;

/** Sum entries into their periods, keyed by the period key. */
export function bucketByPeriod(
	entries: readonly EntryLike[],
	cadence: Period['cadence'],
	options: PeriodOptions
): Map<string, number> {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		const { key } = periodFor(entry.occurredAt, cadence, options);
		totals.set(key, (totals.get(key) ?? 0) + entry.amount);
	}
	return totals;
}

export function buildOrbit(period: Period, logged: number, target: number, dormant = false): Orbit {
	const safeTarget = target > 0 ? target : 1;
	const ratio = logged / safeTarget;
	const fraction = Math.max(0, Math.min(1, ratio));
	return {
		period,
		logged,
		target,
		ratio,
		fraction,
		angle: fraction * 360,
		complete: ratio >= 1,
		remaining: Math.max(0, safeTarget - logged),
		dormant
	};
}

/** True when a period sits entirely inside a span the goal spent archived. */
export function isDormant(period: Period, windows: readonly DormantWindow[]): boolean {
	return windows.some(
		(window) =>
			period.start.getTime() >= window.from.getTime() &&
			(window.until === null || period.end.getTime() <= window.until.getTime())
	);
}

export interface SnapshotOptions extends PeriodOptions {
	/** How many orbits of history to include. */
	historyLength?: number;
	now?: Date;
	/** Spans the goal spent archived, which the streak steps over. */
	dormantWindows?: readonly DormantWindow[];
}

export function snapshotGoal(
	goal: Goal,
	entries: readonly EntryLike[],
	options: SnapshotOptions
): GoalSnapshot {
	const { historyLength = 12, now = new Date(), dormantWindows = [], ...periodOptions } = options;
	const cadence = cadenceOf(goal.tier);
	const totals = bucketByPeriod(entries, cadence, periodOptions);

	const history = recentPeriods(now, cadence, historyLength, periodOptions).map((period) =>
		buildOrbit(period, totals.get(period.key) ?? 0, goal.target, isDormant(period, dormantWindows))
	);

	let totalOrbits = 0;
	let lifetimeLogged = 0;
	for (const total of totals.values()) {
		lifetimeLogged += total;
		if (goal.target > 0 && total >= goal.target) totalOrbits += 1;
	}

	return {
		goal,
		current: history[0],
		history,
		streak: streakFrom(history),
		totalOrbits,
		lifetimeLogged
	};
}

/**
 * Consecutive closed orbits, newest first.
 *
 * The in-flight orbit counts once it closes but never breaks a streak while it
 * is still open — you have not missed this week until the week is over. Orbits
 * the goal spent archived are stepped over entirely, so the newest orbit the
 * goal was actually flying gets that same benefit of the doubt.
 */
export function streakFrom(history: readonly Orbit[]): number {
	let streak = 0;
	let sawLiveOrbit = false;
	for (const orbit of history) {
		if (orbit.dormant) continue;
		if (orbit.complete) {
			streak += 1;
			sawLiveOrbit = true;
			continue;
		}
		if (!sawLiveOrbit) {
			sawLiveOrbit = true;
			continue;
		}
		break;
	}
	return streak;
}

/**
 * How far through its period an instant sits, clamped to 0-1.
 *
 * Periods are unequal by design — a day is 23 or 25 hours across a daylight
 * saving transition, and a quarter is not three equal months — so this reads
 * the span from the period itself rather than assuming a length.
 */
export function periodElapsed(period: Period, now: Date = new Date()): number {
	const span = period.end.getTime() - period.start.getTime();
	if (span <= 0) return 1;
	return Math.max(0, Math.min(1, (now.getTime() - period.start.getTime()) / span));
}

/**
 * How pressing an orbit is, on a 0-1 scale.
 *
 * Two things make an orbit urgent: how much of the target is still missing, and
 * how little of the period is left to cover it. Multiplying them is what makes
 * a Universe goal at 10% unremarkable in January and alarming in November,
 * without ever ranking one tier above another by fiat.
 *
 * A closed orbit has nothing left to do, and a dormant one was never expected
 * to fly, so both score zero — a sleeping goal is not urgent.
 */
export function urgency(orbit: Orbit, now: Date = new Date()): number {
	if (orbit.complete || orbit.dormant) return 0;
	return (1 - orbit.fraction) * periodElapsed(orbit.period, now);
}

/** How close a period has to be to closing for its orbit to count as at risk. */
export const RISK_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an orbit needs attention now: short of target, with the period about
 * to close.
 *
 * A satellite's period is never longer than the window, so every unclosed
 * satellite qualifies; everything larger only surfaces as its deadline nears.
 */
export function isAtRisk(orbit: Orbit, now: Date = new Date(), windowMs = RISK_WINDOW_MS): boolean {
	if (orbit.complete || orbit.dormant) return false;
	return orbit.period.end.getTime() - now.getTime() <= windowMs;
}

export interface TodayFocus {
	/** Short of target with the period closing, most urgent first. */
	atRisk: GoalSnapshot[];
	/** Closed in their current period — kept for the reward, not for the work. */
	closed: GoalSnapshot[];
	/** In flight with room left, most behind first. Nothing here is owed today. */
	steady: GoalSnapshot[];
}

/**
 * Split goals into what today asks for, what it has already given, and what can
 * wait. Pass the same `now` the snapshots were computed with.
 *
 * Both open groups are ranked by urgency, so the long-range goal drifting behind
 * sits at the top of the ones that can wait — the first thing to become work
 * once its own deadline comes into view.
 */
export function focusForToday(
	snapshots: readonly GoalSnapshot[],
	now: Date = new Date(),
	windowMs = RISK_WINDOW_MS
): TodayFocus {
	const atRisk: GoalSnapshot[] = [];
	const closed: GoalSnapshot[] = [];
	const steady: GoalSnapshot[] = [];

	for (const snapshot of snapshots) {
		if (snapshot.current.complete) closed.push(snapshot);
		else if (isAtRisk(snapshot.current, now, windowMs)) atRisk.push(snapshot);
		else steady.push(snapshot);
	}

	return { atRisk: byUrgency(atRisk, now), closed, steady: byUrgency(steady, now) };
}

/** Most urgent first, ties going to the nearer deadline and then the pilot's own order. */
function byUrgency(snapshots: GoalSnapshot[], now: Date): GoalSnapshot[] {
	return snapshots
		.map((snapshot) => ({ snapshot, score: urgency(snapshot.current, now) }))
		.sort(
			(a, b) =>
				b.score - a.score ||
				a.snapshot.current.period.end.getTime() - b.snapshot.current.period.end.getTime() ||
				a.snapshot.goal.sortOrder - b.snapshot.goal.sortOrder
		)
		.map((ranked) => ranked.snapshot);
}

/** How long a period has left, in the coarsest unit that still says something. */
export function formatTimeLeft(period: Period, now: Date = new Date()): string {
	const minutes = Math.floor((period.end.getTime() - now.getTime()) / 60_000);
	if (minutes <= 0) return 'under a minute left';
	if (minutes < 60) return `${minutes}m left`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h left`;
	const days = Math.round(hours / 24);
	return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

/** Format an amount for display, e.g. `1h 30m` or `12 pages`. */
export function formatAmount(value: number, metric: MetricDefinition): string {
	if (metric.kind === 'duration') {
		const totalMinutes = Math.round(value);
		const hours = Math.floor(Math.abs(totalMinutes) / 60);
		const minutes = Math.abs(totalMinutes) % 60;
		const sign = totalMinutes < 0 ? '-' : '';
		if (hours && minutes) return `${sign}${hours}h ${minutes}m`;
		if (hours) return `${sign}${hours}h`;
		return `${sign}${minutes}m`;
	}
	if (metric.kind === 'checkin') {
		const rounded = Math.round(value);
		return `${rounded} ${rounded === 1 ? 'check-in' : 'check-ins'}`;
	}
	const rounded = Math.round(value * 100) / 100;
	return metric.unit ? `${rounded} ${metric.unit}` : String(rounded);
}

/** Quick-log buttons offered for a metric, in its own units. */
export function quickLogSteps(metric: MetricDefinition, target: number): number[] {
	if (metric.kind === 'checkin') return [1];
	if (metric.kind === 'duration') return [15, 30, 60];
	const step = target >= 20 ? 5 : 1;
	return [step, step * 2, step * 5];
}
