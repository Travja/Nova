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

export function buildOrbit(period: Period, logged: number, target: number): Orbit {
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
		remaining: Math.max(0, safeTarget - logged)
	};
}

export interface SnapshotOptions extends PeriodOptions {
	/** How many orbits of history to include. */
	historyLength?: number;
	now?: Date;
}

export function snapshotGoal(
	goal: Goal,
	entries: readonly EntryLike[],
	options: SnapshotOptions
): GoalSnapshot {
	const { historyLength = 12, now = new Date(), ...periodOptions } = options;
	const cadence = cadenceOf(goal.tier);
	const totals = bucketByPeriod(entries, cadence, periodOptions);

	const history = recentPeriods(now, cadence, historyLength, periodOptions).map((period) =>
		buildOrbit(period, totals.get(period.key) ?? 0, goal.target)
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
 * is still open — you have not missed this week until the week is over.
 */
export function streakFrom(history: readonly Orbit[]): number {
	let streak = 0;
	for (const [index, orbit] of history.entries()) {
		if (orbit.complete) {
			streak += 1;
			continue;
		}
		if (index === 0) continue;
		break;
	}
	return streak;
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
