/**
 * Asteroids: the one-offs that never became a cycle.
 *
 * Everything else in Nova is a revolution — progress accumulates inside a
 * period, meets a target, the period resets. A one-off has no period and no
 * reset, and forcing one into a goal would make the orbit and streak machinery
 * lie about what it is measuring. So an asteroid is a title, an optional note
 * and how it ended, and nothing here produces or consumes a `GoalSnapshot`.
 *
 * Pure functions over plain data, like the rest of `$domain`: the belt's
 * ordering, its drift and the capture offer are all decided here so the server
 * and the browser can reach the same answer.
 */

/** The three ways an asteroid leaves the belt. Null means it is still on it. */
export type AsteroidResolution = 'cleared' | 'captured' | 'released';

export const ASTEROID_RESOLUTIONS = ['cleared', 'captured', 'released'] as const;

export function isAsteroidResolution(value: unknown): value is AsteroidResolution {
	return (ASTEROID_RESOLUTIONS as readonly unknown[]).includes(value);
}

export interface Asteroid {
	id: string;
	userId: string;
	title: string;
	note: string | null;
	createdAt: Date;
	/** Starts at `createdAt`; reassigned when the title changes. */
	driftAnchorAt: Date;
	resolution: AsteroidResolution | null;
	resolvedAt: Date | null;
	/** The goal it became, when it was captured. */
	capturedGoalId: string | null;
	/** When the capture offer for this title was turned down on this row. */
	captureDismissedAt: Date | null;
}

/**
 * The one normalization step, used by the recurrence count and by nothing
 * else.
 *
 * Trimmed and case-folded, and deliberately no further: fuzzy matching
 * "clean the garage" to "clean garage" is the kind of cleverness that reads as
 * presumptuous the moment it is wrong, and being wrong here means offering to
 * turn the wrong one-off into a habit.
 */
export function normalizeTitle(title: string): string {
	return title.trim().toLocaleLowerCase();
}

/** How many times the same one-off has to clear before Nova says anything. */
export const CAPTURE_AFTER = 3;

/**
 * Whether a recurrence count is enough to offer capture.
 *
 * Three rather than two: two is a coincidence as often as it is a pattern —
 * "renew the car registration" clears twice a year for years and is never
 * going to be a Planet. Waiting for the third costs nothing, because the
 * manual "this keeps coming back" action is on every asteroid from the moment
 * it exists.
 */
export function shouldOfferCapture(count: number): boolean {
	return count >= CAPTURE_AFTER;
}

/** The little of a resolved asteroid the capture offer reads. */
export interface ResolvedAsteroid {
	title: string;
	resolution: AsteroidResolution | null;
	resolvedAt: Date | null;
	captureDismissedAt?: Date | null;
}

/** Oldest resolution first, so a walk over the list is a walk through time. */
function byResolvedAt(a: ResolvedAsteroid, b: ResolvedAsteroid): number {
	return (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0);
}

/**
 * How many times this title has cleared since it last reset.
 *
 * Only a **cleared** asteroid counts. A **released** one was explicitly let
 * go, which is a vote against recurrence rather than for it, so it resets the
 * count to zero. A **captured** one is neither: the title is already a goal,
 * and whether the rock comes back after that goal is gone is a fresh question
 * rather than a continuation of the old one.
 */
export function recurrenceCount(title: string, resolved: readonly ResolvedAsteroid[]): number {
	const wanted = normalizeTitle(title);
	let count = 0;

	for (const asteroid of [...resolved].sort(byResolvedAt)) {
		if (normalizeTitle(asteroid.title) !== wanted) continue;
		if (asteroid.resolution === 'cleared') count += 1;
		else if (asteroid.resolution === 'released') count = 0;
	}

	return count;
}

/** What the clearing action has to say about the title it just cleared. */
export interface CaptureOffer {
	count: number;
	/** Whether to show the offer — the count is enough and nobody said no. */
	offer: boolean;
}

/**
 * The capture offer for a title, counted and dismissed in one walk.
 *
 * Turning the offer down is remembered against the row it was made on, so
 * "don't ask again until the count restarts" needs no table of its own: a
 * dismissal seen after the last reset silences the offer, and the only thing
 * that resets is a release, which clears the dismissal along with the count.
 */
export function captureOffer(title: string, resolved: readonly ResolvedAsteroid[]): CaptureOffer {
	const wanted = normalizeTitle(title);
	let count = 0;
	let dismissed = false;

	for (const asteroid of [...resolved].sort(byResolvedAt)) {
		if (normalizeTitle(asteroid.title) !== wanted) continue;
		if (asteroid.resolution === 'released') {
			count = 0;
			dismissed = false;
			continue;
		}
		if (asteroid.resolution === 'cleared') count += 1;
		if (asteroid.captureDismissedAt) dismissed = true;
	}

	return { count, offer: !dismissed && shouldOfferCapture(count) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long an asteroid drifts untouched before Nova offers to let it go.
 *
 * Three weeks: long enough that a busy fortnight does not trigger it, short
 * enough that the belt does not quietly become the infinite backlog every
 * to-do app dies of. The offer is an offer — releasing is a legitimate
 * outcome, on the same footing as clearing, never a verdict on the pilot.
 */
export const DRIFT_RELEASE_OFFER_MS = 21 * DAY_MS;

/** Where `drifting` starts: a week untouched is the first visible stage. */
export const DRIFT_DRIFTING_MS = 7 * DAY_MS;

/**
 * The visual stages of drift.
 *
 * `faint` and the release offer share a boundary on purpose. The rock reaching
 * the outer edge of the belt and Nova offering to let it go are the same fact,
 * and the orbit dial already makes that move — position and progress say the
 * same thing twice rather than risking two readings that disagree.
 */
export type DriftBand = 'fresh' | 'drifting' | 'faint';

/** How much room the label has: a sentence, or the number on its own. */
export type LabelStyle = 'long' | 'short';

/** The little of an asteroid that drift depends on. */
export interface DriftInput {
	driftAnchorAt: Date;
}

/** How long since the title was last written, in milliseconds. Never negative. */
export function driftAge(asteroid: DriftInput, now: Date): number {
	return Math.max(0, now.getTime() - asteroid.driftAnchorAt.getTime());
}

export function driftBand(asteroid: DriftInput, now: Date): DriftBand {
	const age = driftAge(asteroid, now);
	if (age >= DRIFT_RELEASE_OFFER_MS) return 'faint';
	if (age >= DRIFT_DRIFTING_MS) return 'drifting';
	return 'fresh';
}

/**
 * How far out the rock has drifted, 0 at the inner edge of the belt and 1 at
 * the outer one, where the release is offered. Clamped, so a rock nobody has
 * touched in a year sits exactly where a rock of three weeks does — drift is
 * a distance, not a debt that keeps growing.
 */
export function driftFraction(asteroid: DriftInput, now: Date): number {
	return Math.min(1, driftAge(asteroid, now) / DRIFT_RELEASE_OFFER_MS);
}

/** Whether the belt should offer to let this one go. */
export function offersRelease(asteroid: DriftInput, now: Date): boolean {
	return driftAge(asteroid, now) >= DRIFT_RELEASE_OFFER_MS;
}

/**
 * How many finished one-offs the belt keeps in view.
 *
 * Bounded on purpose. Seeing what you got through is the point of showing them
 * at all, and an unbounded list of them is the same infinite ledger drift
 * exists to prevent — just a flattering one instead of a reproachful one. A
 * dozen is about a good fortnight of spare ten minutes.
 *
 * Only *cleared* asteroids are ever in it. A released one is gone from every
 * list by decision #4, and a captured one is already on the page above as the
 * goal it became, so listing it here would be saying the same thing twice.
 */
export const DONE_VISIBLE = 12;

/** How a finished one-off says when it was finished. */
export function doneLabel(asteroid: { resolvedAt: Date | null }, now: Date): string {
	if (!asteroid.resolvedAt) return 'Done';

	const days = Math.floor(Math.max(0, now.getTime() - asteroid.resolvedAt.getTime()) / DAY_MS);
	if (days < 1) return 'Done today';
	if (days === 1) return 'Done yesterday';
	if (days < 14) return `Done ${days} days ago`;
	const weeks = Math.round(days / 7);
	return `Done ${weeks} weeks ago`;
}

/**
 * The belt, oldest drift anchor first.
 *
 * One axis and no second one: no manual order, no secondary sort. Goals get
 * `sortOrder` because a person's sense of what matters is not chronological;
 * the belt is deliberately not a prioritized list, it is what is left when
 * nothing else is due, so a second ordering would only be a second way to say
 * what the drift already says — and a chance for the two to disagree.
 *
 * Takes no clock for the same reason: the order is a fact about the rocks, not
 * about when they are being looked at.
 */
export function sortBelt<T extends DriftInput>(asteroids: readonly T[]): T[] {
	return [...asteroids].sort((a, b) => a.driftAnchorAt.getTime() - b.driftAnchorAt.getTime());
}

/**
 * How the belt says how long something has been out there.
 *
 * Two lengths, because compact is a different shape and not the same one with
 * less padding round it: at that density the row puts this on the same line as
 * the two endings, and a sentence does not fit beside two buttons on a phone.
 * The long form is the sentence; the short form is the number, which is all the
 * words were ever carrying — the rock's own distance from the belt says the
 * rest.
 */
export function driftLabel(asteroid: DriftInput, now: Date, style: LabelStyle = 'long'): string {
	const days = Math.floor(driftAge(asteroid, now) / DAY_MS);
	const short = style === 'short';

	if (days < 1) return short ? 'Today' : 'Added today';
	if (days === 1) return short ? '1 day' : 'Drifting a day';
	if (days < 14) return short ? `${days} days` : `Drifting ${days} days`;
	const weeks = Math.round(days / 7);
	return short ? `${weeks} weeks` : `Drifting ${weeks} weeks`;
}
