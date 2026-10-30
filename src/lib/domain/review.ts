import { isFinished, lastInstant as lastFlown } from './ending';
import { dayGrid, type HistoryCell } from './history';
import { fromZonedParts, periodFor, zonedParts, type Period, type PeriodOptions } from './period';
import { buildOrbit, type Orbit } from './progress';
import { cadenceOf, TIERS, type Tier } from './tiers';
import type { Goal } from './types';

/**
 * The year in review (#68): a calendar year of orbits, put together in one
 * place.
 *
 * Everything here reads orbits the service has already built — the same
 * `GoalSnapshot.history` `/stats` reads, sized back to each goal's launch — so
 * the rules about what counts are the ones every other screen already keeps
 * rather than a second copy of them:
 *
 * - **A period belongs to the year containing its last instant**, the rule
 *   `parentPeriodFor` uses for nesting. A week running from 28 December to
 *   3 January belongs to the year it ends in, and a Universe orbit — a whole
 *   year — to its own year rather than the next one its exclusive `end`
 *   points into.
 * - **Possible comes from `Orbit.dormant`**, never from archive windows read
 *   here. Anything that marks a period dormant — an archived span, or a rest
 *   day (#66) that did not close — drops out of "possible" with no change to
 *   this file. A rest day flown anyway is not dormant, and counts.
 * - **Possible starts at launch and stops at the end,** because the history it
 *   is handed does. A goal launched in June had no chance at January, and a
 *   goal that finished (#67) in March had none at April.
 * - **An undecided period is not a miss.** In the year still running, the
 *   orbit in flight counts once it closes and is left out until then, the
 *   same benefit of the doubt `streakFrom` gives it.
 *
 * Nothing here scores anything. The roadmap rules out gamification, so the
 * comparison with last year is the same numbers side by side.
 */

export interface ReviewGoalInput {
	goal: Pick<Goal, 'id' | 'title' | 'tier' | 'color' | 'endsAt'>;
	/** Newest first, back to launch — `GoalSnapshot.history` sized the way `/stats` sizes it. */
	history: readonly Orbit[];
}

/** An orbit note as the review reads it: the period it was written against, and the words. */
export interface ReviewNoteInput {
	goalId: string;
	periodStart: Date;
	body: string;
}

export interface ReviewInputs {
	goals: readonly ReviewGoalInput[];
	notes: readonly ReviewNoteInput[];
	/** When each asteroid was cleared. Captured and released rocks are not cleared. */
	clearedAsteroids: readonly Date[];
}

/** The calendar year an instant falls in, in the user's own zone. */
export function yearOf(instant: Date, timeZone: string): number {
	return zonedParts(instant, timeZone).year;
}

/** The last instant a period covers — its exclusive `end`, less a millisecond. */
function lastInstant(period: Period): Date {
	return new Date(period.end.getTime() - 1);
}

/**
 * The year a period belongs to: the one containing its last instant, read in
 * the user's zone. The same rule nesting uses, for the same reason — reading
 * `end` directly files every Universe orbit under the following year.
 */
export function periodYear(period: Period, timeZone: string): number {
	return yearOf(lastInstant(period), timeZone);
}

/** A goal's orbits that belong to `year`, oldest first. */
export function orbitsInYear(history: readonly Orbit[], year: number, timeZone: string): Orbit[] {
	return history.filter((orbit) => periodYear(orbit.period, timeZone) === year).reverse();
}

/**
 * Whether an orbit was a chance to close one: not dormant, and either over
 * or already closed. An orbit still in flight and still open is neither hit
 * nor missed yet, so it stays out of both sides of the fraction.
 */
export function isPossible(orbit: Orbit, now: Date): boolean {
	if (orbit.dormant) return false;
	return orbit.complete || orbit.period.end.getTime() <= now.getTime();
}

/** A run of consecutive closed orbits: how long, and the dates it covered. */
export interface Flight {
	length: number;
	/** Start of the first period in the run. */
	from: Date;
	/** Last instant of the last period in the run. */
	until: Date;
}

/**
 * The longest run of closed orbits inside the year — `bestStreak`'s rule,
 * walked forward so the run can say when it started and ended.
 *
 * Dormant orbits are transparent: they neither extend nor break a run, so a
 * fortnight spent archived does not split one flight into two. An orbit still
 * in flight and still open is left alone for the same reason. Ties go to the
 * earlier run — the first time you managed it.
 */
export function longestFlight(orbits: readonly Orbit[], now: Date): Flight | null {
	let best: Flight | null = null;
	let current: Flight | null = null;

	for (const orbit of orbits) {
		if (!isPossible(orbit, now)) continue;
		if (!orbit.complete) {
			current = null;
			continue;
		}
		const run: Flight = {
			length: (current?.length ?? 0) + 1,
			from: current?.from ?? orbit.period.start,
			until: lastInstant(orbit.period)
		};
		current = run;
		if (!best || current.length > best.length) best = current;
	}

	return best;
}

export interface Tally {
	closed: number;
	possible: number;
}

function tally(orbits: readonly Orbit[], now: Date): Tally {
	let closed = 0;
	let possible = 0;
	for (const orbit of orbits) {
		if (!isPossible(orbit, now)) continue;
		possible += 1;
		if (orbit.complete) closed += 1;
	}
	return { closed, possible };
}

/** One goal's year, for its row. */
export interface GoalYear extends Tally {
	goalId: string;
	title: string;
	tier: Tier;
	color: string;
	/** The goal's longest flight this year, or 0 with none. */
	bestFlight: number;
	/** Closed of possible, 0-1 — where the body sits on its ring at year's end. */
	standing: number;
	/**
	 * The last instant of a goal that finished this year (#67), or null. A
	 * challenge that ran its course reads as landed rather than as a goal that
	 * simply went quiet.
	 */
	landed: Date | null;
}

/** When a goal landed, if it finished (#67) inside `year`. */
export function landedIn(
	goal: Pick<Goal, 'endsAt'>,
	year: number,
	timeZone: string,
	now: Date
): Date | null {
	if (!goal.endsAt || !isFinished(goal, now)) return null;
	const last = lastFlown(goal.endsAt);
	return yearOf(last, timeZone) === year ? last : null;
}

/** A Universe goal's one orbit of the year, in a line. */
export interface UniverseResult {
	goalId: string;
	title: string;
	color: string;
	/**
	 * `closed` and `open` are decided; `flying` is the year still running with
	 * the orbit not closed yet; `resting` is a year the goal spent dormant.
	 */
	status: 'closed' | 'open' | 'flying' | 'resting';
	/** logged / target, clamped to 0-1 — unit-agnostic, so a derived goal reads the same. */
	fraction: number;
}

/** A note from the year, placed against the goal and period it was written for. */
export interface ReviewNote {
	goalId: string;
	goalTitle: string;
	tier: Tier;
	period: Period;
	body: string;
}

/** One day of the year's sky. */
export interface SkyDay {
	/** `day:2026-03-08` — the day period's own key. */
	key: string;
	/** Orbits of any tier whose period ended on this day and closed. */
	closed: number;
	/** Not yet reached — the year is still running. */
	future: boolean;
	week: number;
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
}

export interface YearSky {
	days: SkyDay[];
	/** Columns in the grid: 53, or 54 for a leap year starting on a Saturday. */
	weeks: number;
	/** The brightest day, for scaling every other one against. */
	brightest: number;
}

/** The headline numbers, the ones put side by side with last year. */
export interface YearNumbers extends Tally {
	/** The longest flight of any goal, in orbits. */
	longestFlight: number;
	notes: number;
	asteroidsCleared: number;
}

export interface YearReview {
	year: number;
	/** False for a year Nova holds nothing for — the page says so kindly. */
	hasData: boolean;
	headline: Tally & { byTier: (Tally & { tier: Tier })[] };
	longest: { goalId: string; title: string; tier: Tier; flight: Flight } | null;
	sky: YearSky;
	goals: GoalYear[];
	universe: UniverseResult[];
	notes: ReviewNote[];
	asteroidsCleared: number;
	/** Last year's headline numbers, when last year has any. */
	lastYear: (YearNumbers & { year: number }) | null;
}

/** Every day of `year` in the user's zone, oldest first. 365 or 366 of them, whatever DST does. */
export function daysOfYear(year: number, options: PeriodOptions): Period[] {
	const days: Period[] = [];
	const noon = { year, month: 1, day: 1, hour: 12, minute: 0, second: 0 };
	let day = periodFor(fromZonedParts(noon, options.timeZone), 'day', options);
	while (periodYear(day, options.timeZone) === year) {
		days.push(day);
		day = periodFor(day.end, 'day', options);
	}
	return days;
}

/**
 * The year as a sky: a mark per day, lit by every orbit that closed with its
 * period ending that day. A Satellite lights its own day, a Planet the last
 * day of its week, a Universe the last day of the year — the same "last
 * instant" that decides which year an orbit is in decides which day.
 *
 * Laid out by `dayGrid`, the history heatmap's own layout, so the two
 * calendars agree about which column a date sits in.
 */
export function yearSky(
	goals: readonly ReviewGoalInput[],
	year: number,
	options: PeriodOptions,
	now: Date
): YearSky {
	const closedByDay = new Map<string, number>();
	for (const { history } of goals) {
		for (const orbit of orbitsInYear(history, year, options.timeZone)) {
			if (orbit.dormant || !orbit.complete) continue;
			const { key } = periodFor(lastInstant(orbit.period), 'day', options);
			closedByDay.set(key, (closedByDay.get(key) ?? 0) + 1);
		}
	}

	const cells: HistoryCell[] = daysOfYear(year, options).map((period) => ({
		orbit: buildOrbit(period, closedByDay.get(period.key) ?? 0, 1),
		details: [],
		note: null
	}));

	const days = dayGrid(cells, options.timeZone).map(({ cell, week, weekday }) => ({
		key: cell.orbit.period.key,
		closed: cell.orbit.logged,
		future: cell.orbit.period.start.getTime() > now.getTime(),
		week,
		weekday
	}));

	return {
		days,
		weeks: (days.at(-1)?.week ?? 0) + 1,
		brightest: Math.max(0, ...days.map((day) => day.closed))
	};
}

/** Each goal that flew in `year`, in the order the goals were handed over. */
export function goalsInYear(
	goals: readonly ReviewGoalInput[],
	year: number,
	timeZone: string,
	now: Date
): GoalYear[] {
	return goals.flatMap(({ goal, history }) => {
		const orbits = orbitsInYear(history, year, timeZone);
		const counts = tally(orbits, now);
		if (counts.possible === 0) return [];
		return [
			{
				goalId: goal.id,
				title: goal.title,
				tier: goal.tier,
				color: goal.color,
				...counts,
				bestFlight: longestFlight(orbits, now)?.length ?? 0,
				standing: counts.closed / counts.possible,
				landed: landedIn(goal, year, timeZone, now)
			}
		];
	});
}

function universeResults(
	goals: readonly ReviewGoalInput[],
	year: number,
	timeZone: string,
	now: Date
): UniverseResult[] {
	return goals.flatMap(({ goal, history }) => {
		if (goal.tier !== 'universe') return [];
		const [orbit] = orbitsInYear(history, year, timeZone);
		if (!orbit) return [];
		const status = orbit.dormant
			? 'resting'
			: orbit.complete
				? 'closed'
				: orbit.period.end.getTime() > now.getTime()
					? 'flying'
					: 'open';
		return [
			{ goalId: goal.id, title: goal.title, color: goal.color, status, fraction: orbit.fraction }
		];
	});
}

/**
 * Notes written against a period of `year`, in the order the periods ran.
 *
 * A note is filed under its period, not under when it was typed — a reflection
 * on the last week of December written on 2 January is about December's week,
 * and that week belongs to whichever year it ends in. Periods that end
 * together (a day and the week it closes) read shortest first, then by goal.
 */
export function notesInYear(
	notes: readonly ReviewNoteInput[],
	goals: readonly ReviewGoalInput[],
	year: number,
	options: PeriodOptions
): ReviewNote[] {
	const byId = new Map(goals.map(({ goal }) => [goal.id, goal]));
	return notes
		.flatMap((note) => {
			const goal = byId.get(note.goalId);
			if (!goal) return [];
			const period = periodFor(note.periodStart, cadenceOf(goal.tier), options);
			if (periodYear(period, options.timeZone) !== year) return [];
			return [{ goalId: goal.id, goalTitle: goal.title, tier: goal.tier, period, body: note.body }];
		})
		.sort(
			(a, b) =>
				a.period.end.getTime() - b.period.end.getTime() ||
				b.period.start.getTime() - a.period.start.getTime() ||
				a.goalTitle.localeCompare(b.goalTitle)
		);
}

function clearedIn(cleared: readonly Date[], year: number, timeZone: string): number {
	return cleared.filter((at) => yearOf(at, timeZone) === year).length;
}

function longestOfYear(
	goals: readonly ReviewGoalInput[],
	year: number,
	timeZone: string,
	now: Date
): YearReview['longest'] {
	let longest: YearReview['longest'] = null;
	for (const { goal, history } of goals) {
		const flight = longestFlight(orbitsInYear(history, year, timeZone), now);
		if (flight && (!longest || flight.length > longest.flight.length)) {
			longest = { goalId: goal.id, title: goal.title, tier: goal.tier, flight };
		}
	}
	return longest;
}

/** The headline numbers for a year, without the rest of the page. */
export function yearNumbers(
	inputs: ReviewInputs,
	year: number,
	options: PeriodOptions,
	now: Date
): YearNumbers {
	const { timeZone } = options;
	const counts = tally(
		inputs.goals.flatMap(({ history }) => orbitsInYear(history, year, timeZone)),
		now
	);
	return {
		...counts,
		longestFlight: longestOfYear(inputs.goals, year, timeZone, now)?.flight.length ?? 0,
		notes: notesInYear(inputs.notes, inputs.goals, year, options).length,
		asteroidsCleared: clearedIn(inputs.clearedAsteroids, year, timeZone)
	};
}

function hasAnything(numbers: YearNumbers): boolean {
	return numbers.possible > 0 || numbers.notes > 0 || numbers.asteroidsCleared > 0;
}

/** The whole page's worth of a year. */
export function yearReview(
	inputs: ReviewInputs,
	year: number,
	options: PeriodOptions,
	now: Date
): YearReview {
	const { timeZone } = options;
	const goals = goalsInYear(inputs.goals, year, timeZone, now);
	const notes = notesInYear(inputs.notes, inputs.goals, year, options);
	const asteroidsCleared = clearedIn(inputs.clearedAsteroids, year, timeZone);

	const byTier = TIERS.flatMap((tier) => {
		const ofTier = goals.filter((goal) => goal.tier === tier);
		if (ofTier.length === 0) return [];
		return [
			{
				tier,
				closed: ofTier.reduce((sum, goal) => sum + goal.closed, 0),
				possible: ofTier.reduce((sum, goal) => sum + goal.possible, 0)
			}
		];
	});

	const previous = yearNumbers(inputs, year - 1, options, now);

	return {
		year,
		hasData: goals.length > 0 || notes.length > 0 || asteroidsCleared > 0,
		headline: {
			closed: byTier.reduce((sum, tier) => sum + tier.closed, 0),
			possible: byTier.reduce((sum, tier) => sum + tier.possible, 0),
			byTier
		},
		longest: longestOfYear(inputs.goals, year, timeZone, now),
		sky: yearSky(inputs.goals, year, options, now),
		goals,
		universe: universeResults(inputs.goals, year, timeZone, now),
		notes,
		asteroidsCleared,
		lastYear: hasAnything(previous) ? { year: year - 1, ...previous } : null
	};
}

/**
 * Whether the dashboard invites you to the review: 26 December to 31 January,
 * in the user's own zone. Late enough in December that the year is all but
 * flown, and long enough into January to catch a slow return from a holiday.
 */
export function inReviewSeason(now: Date, timeZone: string): boolean {
	const { month, day } = zonedParts(now, timeZone);
	return (month === 12 && day >= 26) || month === 1;
}

/**
 * The year a review is about right now: last year through January, this year
 * from February on — when it is a year so far rather than a year flown.
 */
export function reviewYearFor(now: Date, timeZone: string): number {
	const { year, month } = zonedParts(now, timeZone);
	return month === 1 ? year - 1 : year;
}

/**
 * Every year from the account's first launch to the current review year,
 * newest first. Empty before there is one: a first goal launched this January
 * has no last year to look back on.
 */
export function reviewYears(firstLaunch: Date | null, now: Date, timeZone: string): number[] {
	if (!firstLaunch) return [];
	const latest = reviewYearFor(now, timeZone);
	const earliest = yearOf(firstLaunch, timeZone);
	return Array.from({ length: Math.max(0, latest - earliest + 1) }, (_, index) => latest - index);
}
