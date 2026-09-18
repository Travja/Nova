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

/**
 * Whether this one has drifted as far as the belt goes.
 *
 * The strongest form of the offer: the rock is at the outer edge, the band
 * above the list counts how many are out there, and nothing further out is
 * drawn because drift is a distance rather than a debt.
 */
export function atBeltEdge(asteroid: DriftInput, now: Date): boolean {
	return driftAge(asteroid, now) >= DRIFT_RELEASE_OFFER_MS;
}

/**
 * Whether the row carries letting go as one of its own controls yet.
 *
 * Not on a rock added an hour ago. Something you have only just written down
 * is a thing you meant to do, and putting "let it go" beside it before it has
 * had a chance is the app second-guessing a decision nobody has made — while
 * the two controls also crowd a row that has to fit on a phone. Once the rock
 * has visibly started to drift, letting go is a real answer and the row says
 * so.
 *
 * The boundary is the one the drawing already uses. A rock leaves `fresh` and
 * begins to move outward at the same moment its second ending appears, so the
 * controls escalate in step with the picture rather than on a clock of their
 * own — the same bargain `atBeltEdge` and the `faint` band strike.
 *
 * It is never the *only* way to let one go: while a rock is fresh, releasing
 * lives in the row's own disclosure, so the two taps the belt promises are
 * always there.
 */
export function offersRelease(asteroid: DriftInput, now: Date): boolean {
	return driftBand(asteroid, now) !== 'fresh';
}

/**
 * How far across a row a drag has to travel before it means anything, as a
 * fraction of the row's own width, and the floor in pixels that fraction is
 * never allowed to fall below.
 *
 * A fraction alone asks for a 30px drag on a narrow phone and a 90px one on a
 * tablet, which is the same gesture feeling twice as committal on the smaller
 * screen; a fixed distance alone is most of a phone row and a twitch on a
 * desktop. The larger of the two is the one that behaves.
 */
export const SWIPE_COMMIT_FRACTION = 0.26;
export const SWIPE_COMMIT_MIN = 56;

/** What a drag would do if it were let go where it is. */
export type SwipeIntent = 'done' | 'release' | null;

/** The little of a row a swipe has to know about. */
export interface SwipeContext {
	/** The row's own width, so the threshold scales with the screen. */
	width: number;
	/** Whether letting go is on offer at all — it is not, while a rock is fresh. */
	canRelease: boolean;
}

/** How far this row has to be dragged before the drag commits to anything. */
export function swipeThreshold(width: number): number {
	return Math.max(SWIPE_COMMIT_MIN, width * SWIPE_COMMIT_FRACTION);
}

/**
 * What letting go here would do.
 *
 * Right is finishing and left is letting go, which is the direction each one
 * already reads in: a tick is something you push across a list, and a rock you
 * release goes back the way it came. Left answers null while the rock is fresh
 * for the same reason the row has no second mark yet — there is nothing there
 * to commit to.
 */
export function swipeIntent(offset: number, { width, canRelease }: SwipeContext): SwipeIntent {
	const committed = Math.abs(offset) >= swipeThreshold(width);
	if (!committed) return null;
	if (offset > 0) return 'done';
	return canRelease ? 'release' : null;
}

/**
 * How far the row actually moves for a drag of `dx`.
 *
 * Bounded, so a long drag does not throw the row off its own card, and heavily
 * damped in the direction that will not commit to anything: a fresh rock still
 * gives a little to the left, because a gesture that answers with nothing at
 * all reads as a broken row rather than as an answer.
 */
export function swipeOffset(dx: number, { width, canRelease }: SwipeContext): number {
	const limit = Math.max(swipeThreshold(width) * 1.5, SWIPE_COMMIT_MIN);
	const travelled = !canRelease && dx < 0 ? dx * 0.22 : dx;
	return Math.max(-limit, Math.min(limit, travelled));
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
