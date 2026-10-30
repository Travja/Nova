import { periodFor, zonedDayOfWeek, type Period, type PeriodOptions } from './period';

/**
 * Rest days (#66): a Satellite that flies on chosen weekdays and rests on the
 * others.
 *
 * A rest day is a dormant orbit planned in advance. Nothing downstream learns a
 * new idea — `buildOrbit` marks an unclosed rest day dormant and every rule
 * that already steps over an archived period steps over it too. What lives here
 * is only the calendar: which weekdays a mask names, and which span of a
 * goal's schedule was in force on a given day.
 *
 * Schedules are spans with a `from`, the way archive windows are, so changing
 * one never rewrites the past: last month's Saturdays are judged under the
 * schedule last month was flown under.
 */

/**
 * One span of a goal's schedule: from `from` until the next span starts.
 *
 * `restDays` is a seven-bit mask with bit d set when weekday d rests, numbered
 * the way `zonedDayOfWeek` numbers them — 0 is Sunday. No span at all means
 * the goal flies every day, which is every goal that predates this.
 */
export interface RestSchedule {
	from: Date;
	restDays: number;
}

/** Every weekday, as a mask. A schedule resting on all of them is archiving. */
export const EVERY_DAY = 0b111_1111;

/** Short names, indexed by `zonedDayOfWeek`. */
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Whether weekday `day` (0 = Sunday) rests under `mask`. */
export function restsOn(mask: number, day: number): boolean {
	return (mask & (1 << day)) !== 0;
}

/** The mask that rests on every weekday not listed — the form posts the days that fly. */
export function maskFromFlyingDays(flying: readonly number[]): number {
	let mask = EVERY_DAY;
	for (const day of flying) mask &= ~(1 << day);
	return mask;
}

/** The seven weekdays in the order the user's week runs, Monday first by default. */
export function weekdaysInOrder(weekStartsOn = 1): number[] {
	return Array.from({ length: 7 }, (_, index) => (weekStartsOn + index) % 7);
}

/** How many weekdays fly under `mask`. */
export function flyingDayCount(mask: number): number {
	let count = 0;
	for (let day = 0; day < 7; day += 1) if (!restsOn(mask, day)) count += 1;
	return count;
}

/**
 * The rest days in words, in the user's week order — "Sat, Sun" — or null when
 * the goal flies every day.
 */
export function describeRestDays(mask: number, weekStartsOn = 1): string | null {
	const resting = weekdaysInOrder(weekStartsOn).filter((day) => restsOn(mask, day));
	return resting.length === 0 ? null : resting.map((day) => WEEKDAY_NAMES[day]).join(', ');
}

/** The span in force at `instant`: the latest one starting at or before it. */
export function scheduleAt(schedules: readonly RestSchedule[], instant: Date): RestSchedule | null {
	let inForce: RestSchedule | null = null;
	for (const schedule of schedules) {
		if (schedule.from.getTime() > instant.getTime()) continue;
		if (!inForce || schedule.from.getTime() >= inForce.from.getTime()) inForce = schedule;
	}
	return inForce;
}

/** The newest span, whatever it starts — the schedule a goal flies from here on. */
export function latestSchedule(schedules: readonly RestSchedule[]): RestSchedule | null {
	let latest: RestSchedule | null = null;
	for (const schedule of schedules) {
		if (!latest || schedule.from.getTime() >= latest.from.getTime()) latest = schedule;
	}
	return latest;
}

/**
 * Whether a period is a rest day under the schedule in force when it starts.
 *
 * Only a day can rest — rest weeks and rest months are archiving by another
 * name — so every other cadence answers false whatever its spans say, which is
 * also what makes a goal moved off Satellite stop resting at once.
 *
 * The weekday is read in the user's zone at the period's start. A day's start
 * is local midnight, so this is the local weekday by construction, and a 23- or
 * 25-hour day across a daylight saving transition is still one weekday.
 */
export function restDayUnder(
	period: Period,
	schedules: readonly RestSchedule[],
	timeZone: string
): boolean {
	if (period.cadence !== 'day' || schedules.length === 0) return false;
	const inForce = scheduleAt(schedules, period.start);
	if (!inForce) return false;
	return restsOn(inForce.restDays, zonedDayOfWeek(period.start, timeZone));
}

/** What a schedule change writes: drop pending spans from `from`, then maybe add one. */
export interface ScheduleChange {
	/** Spans starting at or after this are replaced. */
	from: Date;
	/** The span to add, or null when the schedule already says this. */
	insert: RestSchedule | null;
}

/**
 * How a goal's schedule changes to `restDays`, saved at `now`.
 *
 * A change starts tomorrow, never today or earlier — today was planned under
 * the schedule it started with, and a rest day declared at breakfast would let
 * a missed day be renamed after the fact. A goal being launched has no past to
 * protect, so `launching` starts its first span at the start of today.
 *
 * Saving twice in a day replaces tomorrow's pending span rather than stacking a
 * second, and saving what is already in force writes nothing at all.
 */
export function scheduleChange(
	schedules: readonly RestSchedule[],
	restDays: number,
	now: Date,
	options: PeriodOptions & { launching?: boolean }
): ScheduleChange {
	const today = periodFor(now, 'day', options);
	// A day's exclusive end is the instant tomorrow starts.
	const from = options.launching ? today.start : today.end;
	const kept = schedules.filter((schedule) => schedule.from.getTime() < from.getTime());
	const inForce = scheduleAt(kept, from)?.restDays ?? 0;
	return { from, insert: inForce === restDays ? null : { from, restDays } };
}
