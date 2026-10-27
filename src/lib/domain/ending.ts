import { fromZonedParts, periodFor, zonedParts, type Period, type PeriodOptions } from './period';
import { cadenceOf, type Tier } from './tiers';
import type { Goal } from './types';

/**
 * Goals that end — see `docs/issues/67-goals-that-end.md`.
 *
 * A goal with an end flies until the instant in `goal.endsAt` and is finished
 * from then on. That instant is the exclusive `end` of the last period the goal
 * flies, worked out once, when the goal is saved, from a last day read in the
 * user's own zone. After that it is a plain UTC instant like every other
 * timestamp Nova keeps: nothing here stores a local time, and a pilot who moves
 * zone finishes at the same moment they would have finished at home.
 *
 * Finished is a fact about the clock rather than a thing anybody does, so it is
 * read here from `endsAt` and `now` instead of being written to a column. Nothing
 * has to notice the end passing for the goal to land.
 */

/** Where a goal stands: in orbit, parked, or done. */
export type GoalStatus = 'flying' | 'archived' | 'finished';

/** True once the goal's last period is over. */
export function isFinished(goal: Pick<Goal, 'endsAt'>, now: Date): boolean {
	return goal.endsAt !== null && goal.endsAt.getTime() <= now.getTime();
}

/**
 * Finished before archived: a goal whose end passes while it is parked finishes
 * at once, because there is nothing left for restoring it to bring back.
 */
export function goalStatus(goal: Pick<Goal, 'endsAt' | 'archivedAt'>, now: Date): GoalStatus {
	if (isFinished(goal, now)) return 'finished';
	return goal.archivedAt ? 'archived' : 'flying';
}

/** Still in orbit: neither finished nor archived. */
export function isFlying(goal: Pick<Goal, 'endsAt' | 'archivedAt'>, now: Date): boolean {
	return goalStatus(goal, now) === 'flying';
}

/** The last instant a goal with an end covers — `endsAt` is exclusive, like `period.end`. */
export function lastInstant(endsAt: Date): Date {
	return new Date(endsAt.getTime() - 1);
}

/**
 * The instant a goal's screens are drawn at.
 *
 * A finished goal is drawn at its last instant, so its record is the periods it
 * flew and its final orbit is the last of them. An archived one is frozen at the
 * moment it was archived, as it always was. Anything else is drawn now.
 */
export function recordInstant(goal: Pick<Goal, 'endsAt' | 'archivedAt'>, now: Date): Date {
	if (goal.endsAt && isFinished(goal, now)) return lastInstant(goal.endsAt);
	return goal.archivedAt ?? now;
}

/** True when `period` is the last one a goal with an end flies. */
export function isFinalPeriod(goal: Pick<Goal, 'endsAt'>, period: Period): boolean {
	return !!goal.endsAt && period.end.getTime() >= goal.endsAt.getTime();
}

/** A calendar date as a pilot reads it on their own wall, with no zone attached. */
export interface LocalDate {
	year: number;
	month: number;
	day: number;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Read a `<input type="date">` value. Null when it is not a real calendar date. */
export function parseLocalDate(value: string | null | undefined): LocalDate | null {
	const match = LOCAL_DATE.exec(value?.trim() ?? '');
	if (!match) return null;
	const [year, month, day] = match.slice(1).map(Number);
	const check = new Date(Date.UTC(year, month - 1, day));
	if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
	return { year, month, day };
}

/** The other way round, for filling a date field. */
export function formatLocalDate(date: LocalDate): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** The calendar date an instant falls on in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
	const { year, month, day } = zonedParts(instant, timeZone);
	return { year, month, day };
}

/** Calendar arithmetic on a wall date. UTC is only the calculator here; no instant is formed. */
function addDays(date: LocalDate, days: number): LocalDate {
	const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate()
	};
}

/**
 * The end instant for a goal whose last day is `lastDay`: the end of the period
 * of its own cadence that holds that day.
 *
 * The day is read at noon rather than midnight. A few zones skip midnight on the
 * day their clocks change, and noon is inside every day that exists, so the
 * period it lands in is always the one the pilot meant.
 */
export function endInstant(lastDay: LocalDate, tier: Tier, options: PeriodOptions): Date {
	const noon = fromZonedParts({ ...lastDay, hour: 12, minute: 0, second: 0 }, options.timeZone);
	return periodFor(noon, cadenceOf(tier), options).end;
}

/** The ends the form offers besides a date of the pilot's own. */
export const END_PRESETS = ['30d', '12w', 'quarter'] as const;
export type EndPreset = (typeof END_PRESETS)[number];

/** What the form's "Ends" control can say. `keep` leaves a stored end exactly as it is. */
export const END_CHOICES = ['', 'keep', ...END_PRESETS, 'date'] as const;
export type EndChoice = (typeof END_CHOICES)[number];

export const END_PRESET_LABEL: Record<EndPreset, string> = {
	'30d': 'After 30 days',
	'12w': 'After 12 weeks',
	quarter: 'At the end of this quarter'
};

/**
 * The last day a preset names, counting today as the first.
 *
 * "30 days" is today and the 29 after it, which is what a 30-day challenge
 * started this morning means.
 */
export function presetLastDay(preset: EndPreset, now: Date, options: PeriodOptions): LocalDate {
	const today = localDateOf(now, options.timeZone);
	switch (preset) {
		case '30d':
			return addDays(today, 29);
		case '12w':
			return addDays(today, 12 * 7 - 1);
		case 'quarter':
			return localDateOf(lastInstant(periodFor(now, 'quarter', options).end), options.timeZone);
	}
}

/** Why an end was refused. */
export type EndProblem = 'date' | 'past';

export const END_PROBLEM_MESSAGE: Record<EndProblem, string> = {
	date: 'Pick the last day the goal flies.',
	past: 'The last day has to be in the orbit in flight or later — the periods behind it are already decided.'
};

export type EndResolution = { ok: true; endsAt: Date | null } | { ok: false; problem: EndProblem };

/**
 * Turn what the form said into the instant to store.
 *
 * A new end can't fall before the period in flight ends: the periods behind it
 * are decided, and ending a goal inside them would rewrite a record rather than
 * close one. Keeping the end a goal already has is always allowed, which is how
 * a finished goal's title can still be corrected without bringing it back.
 */
export function resolveEnd(
	choice: EndChoice,
	endsOn: string | null | undefined,
	context: { tier: Tier; now: Date; options: PeriodOptions; current: Date | null }
): EndResolution {
	const { tier, now, options, current } = context;
	if (choice === '') return { ok: true, endsAt: null };
	if (choice === 'keep') return { ok: true, endsAt: current };

	const lastDay = choice === 'date' ? parseLocalDate(endsOn) : presetLastDay(choice, now, options);
	if (!lastDay) return { ok: false, problem: 'date' };

	const endsAt = endInstant(lastDay, tier, options);
	if (endsAt.getTime() < periodFor(now, cadenceOf(tier), options).end.getTime()) {
		return { ok: false, problem: 'past' };
	}
	return { ok: true, endsAt };
}

/**
 * The end a child takes when its parent ends and it ends with it: the end of the
 * child's own period that holds the parent's last instant.
 *
 * A week that straddles the parent's last month runs to its own end rather than
 * being cut short, and — since a closed week counts toward the month it ends
 * in — that one week feeds nothing. Cutting it short instead would leave a
 * period no cadence has.
 */
export function endUnder(parentEndsAt: Date, childTier: Tier, options: PeriodOptions): Date {
	return periodFor(lastInstant(parentEndsAt), cadenceOf(childTier), options).end;
}

/**
 * Whether a child would still be flying after its parent has ended: it has no
 * end, or its last period starts at or after the parent's end.
 *
 * Read from where the child's last period *starts* rather than from the two
 * instants side by side, so a child given `endUnder()` — which can run past
 * the parent's end by most of one of its own periods — never counts as
 * outliving it, and nor does one whose end was worked out in a zone the pilot
 * has since left.
 */
export function outlives(
	child: { tier: Tier; endsAt?: Date | null },
	parent: { endsAt?: Date | null },
	options: PeriodOptions
): boolean {
	if (!parent.endsAt) return false;
	if (!child.endsAt) return true;
	const last = periodFor(lastInstant(child.endsAt), cadenceOf(child.tier), options);
	return last.start.getTime() >= parent.endsAt.getTime();
}
