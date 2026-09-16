import { periodElapsed, isDormant, type DormantWindow, type Orbit } from './progress';
import {
	periodFor,
	previousPeriod,
	zonedDayOfWeek,
	zonedParts,
	type PeriodOptions
} from './period';
import type { Cadence, Tier } from './tiers';
import { TIERS } from './tiers';
import type { ProgressEntry } from './types';

/**
 * The four numbers issue #16 asks for, each a pure function beside
 * `snapshotGoal()` — same shape as `streakFrom` and `urgency`, over data the
 * server has already loaded rather than anything reaching for a database.
 *
 * Two things the spec predates change what a correct answer is here, same as
 * everywhere else in the domain:
 *
 * - A dormant orbit (`Orbit.dormant`) was never flown, so it comes out of a
 *   denominator rather than counting as a miss — `completionByTier` and
 *   `bestStreak` both skip it exactly the way `streakFrom` does.
 * - A derived goal's orbit is unit-agnostic — closing one means the same
 *   thing whether it counts pages or child orbits — so `bestStreak` and
 *   `completionByTier` take it exactly like a leaf's. Momentum and the
 *   logging rhythm do not: both need a continuous stream of timestamped
 *   entries, and a parent has none of its own — its number moves in a jump
 *   whenever a child orbit closes, not while its own period runs. Callers
 *   pass leaf goals only for those two.
 */

type EntryLike = Pick<ProgressEntry, 'amount' | 'occurredAt'>;

/**
 * The longest run of consecutive closed orbits a goal has ever had, not just
 * the one still standing.
 *
 * Same rule as `streakFrom`: a dormant orbit is transparent — it neither
 * extends a run nor breaks one — and the orbit still in flight is never
 * counted as a miss just because it has not closed yet. Unlike `streakFrom`,
 * every other unclosed orbit does break the run, because this is asking about
 * the past, not giving today the benefit of the doubt.
 *
 * `history` is newest-first, the same convention `GoalSnapshot.history`
 * uses, and needs to cover the goal's whole lifetime for the answer to mean
 * "ever" — a caller after a real answer should pass an unbounded history,
 * not the 12-orbit window `snapshotGoal` defaults to.
 */
export function bestStreak(history: readonly Orbit[]): number {
	let best = 0;
	let current = 0;
	let sawLiveOrbit = false;
	for (const orbit of history) {
		if (orbit.dormant) continue;
		if (orbit.complete) {
			current += 1;
			best = Math.max(best, current);
			sawLiveOrbit = true;
			continue;
		}
		if (!sawLiveOrbit) {
			// The orbit still in flight. Not a miss yet, so it neither
			// extends nor breaks a run — but this current-orbit exemption is
			// spent the first time it is used, same as `streakFrom`.
			sawLiveOrbit = true;
			continue;
		}
		current = 0;
	}
	return best;
}

/** A goal's current and best streak, for a short list ranked by best. */
export interface GoalStreak {
	goalId: string;
	title: string;
	tier: Tier;
	current: number;
	best: number;
}

/**
 * Every goal's current and best streak, best first.
 *
 * `history` per goal is expected to be the same unbounded lifetime array
 * `bestStreak` wants — `current` is computed from it too, which reads the
 * live streak more accurately than the 12-orbit window the dashboard shows
 * whenever a streak happens to run longer than that.
 */
export function goalStreaks(
	goals: readonly { goalId: string; title: string; tier: Tier; history: readonly Orbit[] }[]
): GoalStreak[] {
	return goals
		.map((goal) => ({
			goalId: goal.goalId,
			title: goal.title,
			tier: goal.tier,
			current: currentStreak(goal.history),
			best: bestStreak(goal.history)
		}))
		.sort((a, b) => b.best - a.best || b.current - a.current);
}

/**
 * The live streak, reading `history` the same way `streakFrom` does. Kept
 * local rather than imported so this file's only dependency on `progress.ts`
 * stays the plain data it already needed — `streakFrom` and this function
 * agree because they are the same rule, not because one calls the other.
 */
function currentStreak(history: readonly Orbit[]): number {
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

/** How many decided periods a tier closed, out of how many it had a chance to. */
export interface TierCompletion {
	tier: Tier;
	closed: number;
	decided: number;
	rate: number;
}

/**
 * Completion rate per tier — are Satellites carrying everything while
 * Galaxies quietly rot?
 *
 * A period only counts once it is decided: dormant periods are skipped (the
 * goal was archived, not failing) and the orbit still in flight is skipped
 * too (its period has not closed, so it has neither hit nor missed). Only
 * tiers with at least one decided period are returned, so a tier nobody has
 * flown for long enough yet stays off the list instead of showing a hollow
 * 0%.
 */
export function completionByTier(
	goals: readonly { tier: Tier; history: readonly Orbit[] }[],
	now: Date
): TierCompletion[] {
	const totals = new Map<Tier, { closed: number; decided: number }>();

	for (const goal of goals) {
		for (const orbit of goal.history) {
			if (orbit.dormant) continue;
			if (orbit.period.end.getTime() > now.getTime()) continue;
			const bucket = totals.get(goal.tier) ?? { closed: 0, decided: 0 };
			bucket.decided += 1;
			if (orbit.complete) bucket.closed += 1;
			totals.set(goal.tier, bucket);
		}
	}

	return TIERS.filter((tier) => (totals.get(tier)?.decided ?? 0) > 0).map((tier) => {
		const bucket = totals.get(tier) as { closed: number; decided: number };
		return {
			tier,
			closed: bucket.closed,
			decided: bucket.decided,
			rate: bucket.closed / bucket.decided
		};
	});
}

/** The completion rate across every tier at once, for a single headline number. */
export function overallCompletion(tiers: readonly TierCompletion[]): {
	closed: number;
	decided: number;
	rate: number | null;
} {
	const closed = tiers.reduce((sum, tier) => sum + tier.closed, 0);
	const decided = tiers.reduce((sum, tier) => sum + tier.decided, 0);
	return { closed, decided, rate: decided > 0 ? closed / decided : null };
}

/** How many periods of `cadence` have started between a goal's launch and `now`. */
export function periodsSinceLaunch(
	createdAt: Date,
	now: Date,
	cadence: Cadence,
	options: PeriodOptions
): number {
	let period = periodFor(now, cadence, options);
	let count = 1;
	while (period.start.getTime() > createdAt.getTime()) {
		period = previousPeriod(period, options);
		count += 1;
	}
	return count;
}

/** How far back momentum looks for a baseline pace, when a goal has that much history. */
export const MOMENTUM_LOOKBACK = 12;

export interface MomentumInput {
	goalId: string;
	title: string;
	tier: Tier;
	cadence: Cadence;
	createdAt: Date;
	entries: readonly EntryLike[];
	dormantWindows: readonly DormantWindow[];
}

export interface Momentum {
	goalId: string;
	title: string;
	tier: Tier;
	/**
	 * Current pace divided by this goal's own average pace at the same point
	 * in past periods — 1.3 means running 30% ahead of its own history, not
	 * ahead of an assumed-linear target. Null when there is not yet a
	 * baseline to compare against: a goal younger than one full period, or
	 * one whose only history is dormant.
	 */
	ratio: number | null;
}

function sumBetween(entries: readonly EntryLike[], start: number, end: number): number {
	let total = 0;
	for (const entry of entries) {
		const at = entry.occurredAt.getTime();
		if (at >= start && at < end) total += entry.amount;
	}
	return total;
}

/**
 * This period's pace against the same point in previous periods — not
 * against a straight line to the target, which is what `isBehindPace`
 * already tells you. A goal that is always slow to start and always closes
 * in the last day should not read as "behind" every single week; momentum is
 * the number that says whether *this* week is behind its own normal shape.
 *
 * Only non-dormant periods since the goal's launch count as history, up to
 * `MOMENTUM_LOOKBACK` of them — the same window `snapshotGoal` defaults its
 * own history to. A goal with no such period yet gets `ratio: null` rather
 * than a divide-by-zero or a comparison against nothing.
 */
export function momentumFor(
	input: MomentumInput,
	options: PeriodOptions,
	now: Date,
	lookback = MOMENTUM_LOOKBACK
): Momentum {
	const current = periodFor(now, input.cadence, options);
	const elapsed = periodElapsed(current, now, input.createdAt);
	const currentSoFar = sumBetween(input.entries, current.start.getTime(), now.getTime());

	const samples: number[] = [];
	let period = current;
	while (samples.length < lookback) {
		const previous = previousPeriod(period, options);
		if (previous.start.getTime() < input.createdAt.getTime()) break;
		period = previous;
		if (!isDormant(period, input.dormantWindows)) {
			const cutoff =
				period.start.getTime() + elapsed * (period.end.getTime() - period.start.getTime());
			samples.push(sumBetween(input.entries, period.start.getTime(), cutoff));
		}
	}

	if (samples.length === 0) {
		return { goalId: input.goalId, title: input.title, tier: input.tier, ratio: null };
	}

	const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	if (average <= 0) {
		return {
			goalId: input.goalId,
			title: input.title,
			tier: input.tier,
			ratio: currentSoFar > 0 ? null : 1
		};
	}

	return {
		goalId: input.goalId,
		title: input.title,
		tier: input.tier,
		ratio: currentSoFar / average
	};
}

/** The average momentum across goals that have one, or null if none do yet. */
export function averageMomentum(momenta: readonly Momentum[]): number | null {
	const ratios = momenta
		.map((momentum) => momentum.ratio)
		.filter((ratio): ratio is number => ratio !== null);
	if (ratios.length === 0) return null;
	return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

/** The goals pulling furthest ahead of and behind their own usual pace, few each. */
export function topMomentum(
	momenta: readonly Momentum[],
	count = 3
): { gaining: Momentum[]; slipping: Momentum[] } {
	const rated = momenta.filter((momentum) => momentum.ratio !== null);
	const gaining = [...rated]
		.sort((a, b) => (b.ratio as number) - (a.ratio as number))
		.slice(0, count);
	const slipping = [...rated]
		.sort((a, b) => (a.ratio as number) - (b.ratio as number))
		.slice(0, count)
		.filter((momentum) => !gaining.includes(momentum));
	return { gaining, slipping };
}

/** A day of the week, in a fixed order starting Sunday, matching `Date#getDay`. */
const WEEKDAY_LABELS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];

const PART_OF_DAY = ['Night', 'Morning', 'Afternoon', 'Evening'] as const;
type PartOfDay = (typeof PART_OF_DAY)[number];

/** Which quarter of the day an hour (0-23, in the user's own zone) falls in. */
function partOfDay(hour: number): PartOfDay {
	if (hour < 6) return 'Night';
	if (hour < 12) return 'Morning';
	if (hour < 18) return 'Afternoon';
	return 'Evening';
}

export interface LoggingRhythm {
	/** Entry counts by weekday, Sunday first — matches `WEEKDAY_LABELS`. */
	byWeekday: number[];
	byPartOfDay: { part: PartOfDay; count: number }[];
	/** The weekday with the most entries, or null with nothing logged yet. */
	peakWeekday: string | null;
	peakPart: PartOfDay | null;
}

/**
 * When entries actually land, in the user's own time zone — the surprise the
 * spec asks for, and the one number here that is about behaviour rather than
 * outcome. Counts entries rather than amounts, so a single two-hour session
 * does not outweigh five separate check-ins the way summing durations would.
 *
 * Takes leaf goals' entries only: a derived goal is refused a log at write
 * time, so its own entry table is always empty and this needs no filtering
 * to keep from double-counting a child's log under its parent too.
 */
export function loggingRhythm(
	entries: readonly EntryLike[],
	options: PeriodOptions
): LoggingRhythm {
	const byWeekday = new Array(7).fill(0);
	const byPart = new Map<PartOfDay, number>(PART_OF_DAY.map((part) => [part, 0]));

	for (const entry of entries) {
		const day = zonedDayOfWeek(entry.occurredAt, options.timeZone);
		byWeekday[day] += 1;
		const hour = zonedParts(entry.occurredAt, options.timeZone).hour;
		const part = partOfDay(hour);
		byPart.set(part, (byPart.get(part) ?? 0) + 1);
	}

	const total = entries.length;
	const peakWeekdayIndex = total > 0 ? byWeekday.indexOf(Math.max(...byWeekday)) : -1;
	const byPartOfDay = PART_OF_DAY.map((part) => ({ part, count: byPart.get(part) ?? 0 }));
	const peakPartEntry =
		total > 0 ? byPartOfDay.reduce((a, b) => (b.count > a.count ? b : a)) : null;

	return {
		byWeekday,
		byPartOfDay,
		peakWeekday: peakWeekdayIndex >= 0 ? WEEKDAY_LABELS[peakWeekdayIndex] : null,
		peakPart: peakPartEntry && peakPartEntry.count > 0 ? peakPartEntry.part : null
	};
}
