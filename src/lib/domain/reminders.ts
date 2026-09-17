import { periodFor, zonedParts } from './period';
import { isClosing, urgency, type GoalSnapshot } from './progress';
import { CADENCE_LABEL, cadenceOf, type Cadence } from './tiers';

/**
 * What is worth interrupting someone for, and what it is allowed to say.
 *
 * Every decision a reminder needs is made here, over the same snapshots the
 * Today view is built from: which orbit deserves a nudge, whether the hour and
 * the day's budget allow one, and what the notification reads. The sending half
 * — subscriptions, VAPID, the push service — lives in `$lib/server/push` and
 * makes no judgements of its own.
 *
 * Two rules shape all of it.
 *
 * **Never nag about something that is already done.** A closed orbit and a
 * dormant one are both silent, at every rule below, because being nagged about
 * work you finished is the fastest way to turn notifications off for good.
 *
 * **Never put the user's own words on a lock screen.** A goal's title is theirs
 * and a notification is read by whoever is holding the phone, so nothing below
 * ever reaches for `goal.title`: a reminder counts orbits and names cadences,
 * and the app says which goal once the tap has gone through the sign-in the
 * rest of Nova is behind.
 */

/** Minutes past local midnight, as a wall clock in the user's own zone reads. */
export function minuteOfDay(instant: Date, timeZone: string): number {
	const parts = zonedParts(instant, timeZone);
	return parts.hour * 60 + parts.minute;
}

/**
 * When not to speak, in local minutes past midnight.
 *
 * Quiet hours are a wall-clock idea — "not after ten at night" means ten where
 * the person is — so this is stored as minutes and resolved against their zone
 * rather than as an instant.
 */
export interface QuietHours {
	/** Inclusive start. */
	from: number;
	/** Exclusive end. Smaller than `from` when the window crosses midnight. */
	until: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { from: 22 * 60, until: 7 * 60 };

const WALL_CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Read a `<input type="time">` value as minutes past midnight, or null. */
export function parseMinuteOfDay(value: string): number | null {
	const match = WALL_CLOCK.exec(value.trim());
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The same minutes back as a `time` input wants them: `22:00`. */
export function formatMinuteOfDay(minute: number): string {
	const wrapped = ((minute % 1440) + 1440) % 1440;
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** A quiet window that crosses midnight is the normal case, not the exception. */
export function inQuietHours(instant: Date, timeZone: string, quiet: QuietHours): boolean {
	// Equal bounds are an empty window rather than a whole silent day: a reminder
	// nobody could ever receive is not a setting anyone means to choose.
	if (quiet.from === quiet.until) return false;

	const minute = minuteOfDay(instant, timeZone);
	return quiet.from < quiet.until
		? minute >= quiet.from && minute < quiet.until
		: minute >= quiet.from || minute < quiet.until;
}

/**
 * The hard cap: one nudge per day, and this is the whole of it.
 *
 * One useful reminder beats five ignored ones. Counting in the account's own
 * days rather than in elapsed hours is what matches how it feels — a second
 * notification at 00:05 is a second notification today, whatever the clock
 * arithmetic says — and it is why this takes a zone rather than a duration.
 */
export function alreadyRemindedToday(
	lastSentAt: Date | null,
	now: Date,
	timeZone: string
): boolean {
	if (!lastSentAt) return false;
	const day = (instant: Date) => periodFor(instant, 'day', { timeZone }).key;
	return day(lastSentAt) === day(now);
}

/**
 * How much of a target must still be missing for a closing period to be worth
 * mentioning. The mascot draws the same line for the same reason: above it,
 * there is still an evening worth having and no need to say anything.
 */
export const SHORTFALL = 0.5;

/** A streak has to be worth saving before its being at risk is news. */
export const STREAK_WORTH_SAVING = 2;

/** "A period ending within a day", which is the second rule the issue asks for. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a reminder is being sent. Ordered by how much it earns the interruption:
 * a streak someone has built is worth more than a period that is merely short.
 */
export type ReminderKind = 'streak' | 'deadline' | 'closing';

const KIND_RANK: Record<ReminderKind, number> = { streak: 2, deadline: 1, closing: 0 };

export interface Reminder {
	kind: ReminderKind;
	/** The cadence of the orbit that decided it. */
	cadence: Cadence;
	/** How many orbits are in the same trouble, which is all the body says. */
	count: number;
	/** The streak at risk, for a `streak` reminder; zero otherwise. */
	streak: number;
	/**
	 * Which orbit decided it. For logs and for tests — never for the payload,
	 * which carries no goal identity at all.
	 */
	goalId: string;
}

interface Candidate extends Reminder {
	urgency: number;
}

/** The one rule this orbit trips, or null when it is not worth saying anything. */
function candidateFor(snapshot: GoalSnapshot, now: Date): Candidate | null {
	const { current, goal } = snapshot;

	// A closed orbit is finished, a dormant one was never expected to fly, and a
	// derived goal counts what its children close — there is nothing its owner
	// could do about it from a notification.
	if (current.complete || current.dormant || snapshot.derived) return null;

	const cadence = cadenceOf(goal.tier);
	const closing = isClosing(current, now);
	const shape = {
		cadence,
		count: 1,
		goalId: goal.id,
		streak: 0,
		urgency: urgency(current, now)
	};

	// A streak about to break. `closing` is what makes it "about to": a streak is
	// not at risk on Monday morning.
	if (closing && snapshot.streak >= STREAK_WORTH_SAVING) {
		return { ...shape, kind: 'streak', streak: snapshot.streak };
	}

	// A period ending within a day and well short of its target.
	//
	// `closing` as well as the day, because on a daily orbit "ends within a day"
	// is true at breakfast and says nothing — the same trap #48 found in the
	// Today view. At every longer cadence the last day is inside the closing
	// window anyway, so this reads as one condition at all five.
	const endsWithinADay = current.period.end.getTime() - now.getTime() <= DAY_MS;
	if (closing && endsWithinADay && current.fraction < SHORTFALL) {
		return { ...shape, kind: 'deadline' };
	}

	// A satellite unclosed late in its day — which is what `isClosing` means for
	// a daily period now that the window is a quarter of the period (#48).
	if (closing && cadence === 'day') return { ...shape, kind: 'closing' };

	return null;
}

/**
 * The single reminder these snapshots are worth, or null for silence.
 *
 * One reminder, never a digest of three: the cap is one a day, so the one that
 * goes out is the most pressing thing there is. Orbits in the same trouble are
 * counted rather than listed.
 */
export function reminderFor(snapshots: readonly GoalSnapshot[], now: Date): Reminder | null {
	const candidates = snapshots
		.map((snapshot) => candidateFor(snapshot, now))
		.filter((candidate): candidate is Candidate => candidate !== null);
	if (candidates.length === 0) return null;

	const [best] = candidates.sort(
		(a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.urgency - a.urgency
	);
	const { urgency: _urgency, ...reminder } = best;
	return { ...reminder, count: candidates.filter((each) => each.kind === best.kind).length };
}

/** What a device is actually asked to show. */
export interface ReminderMessage {
	title: string;
	body: string;
	/** Replaces an earlier unread reminder rather than stacking on it. */
	tag: string;
	/** Where the tap goes. The detail lives behind it, not in the payload. */
	url: string;
}

/** Every reminder lands on the view that can do something about it. */
const REMINDER_URL = '/today';

/**
 * A reminder in words, with nothing in it that should not sit on a lock screen.
 *
 * Counts, cadences and a streak length — no titles, no notes, no amounts, and
 * no goal id. Whoever taps it gets the specifics from Nova itself, which is
 * behind a session; whoever merely glances at the phone learns that somebody
 * tracks goals, and nothing else.
 */
export function reminderMessage(reminder: Reminder): ReminderMessage {
	const label = CADENCE_LABEL[reminder.cadence];
	const orbits = reminder.count === 1 ? 'orbit' : 'orbits';

	switch (reminder.kind) {
		case 'streak':
			return {
				title: 'A streak is about to break',
				body: `${reminder.streak} orbits in a row, and this one is still open. There is time ${label}.`,
				tag: 'nova-streak',
				url: REMINDER_URL
			};
		case 'deadline':
			return {
				title: 'An orbit is running out of time',
				body: `${reminder.count} ${orbits} ${reminder.count === 1 ? 'is' : 'are'} short of target with ${label} nearly over.`,
				tag: 'nova-deadline',
				url: REMINDER_URL
			};
		case 'closing':
			return {
				title: 'Still time to close it',
				body: `${reminder.count} ${orbits} ${reminder.count === 1 ? 'has' : 'have'} yet to close ${label}.`,
				tag: 'nova-closing',
				url: REMINDER_URL
			};
	}
}
