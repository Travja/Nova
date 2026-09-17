import {
	captureOffer,
	sortBelt,
	type Asteroid,
	type AsteroidResolution,
	type CaptureOffer
} from '$domain/asteroids';
import type { AsteroidInput, GoalInput } from '$domain/validation';
import { db } from '$lib/server/db';
import { asteroids, type AsteroidRow } from '$lib/server/db/schema';
import { newId } from '$lib/server/auth/session';
import { createGoal, type GoalWriteResult } from '$lib/server/goals';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

/**
 * The belt, server side.
 *
 * Every function here re-reads the row under the caller's `userId`, exactly as
 * `logEntry()` does with a goal: an id alone is never enough to clear, release
 * or capture somebody else's one-off, and putting that in the service means
 * every caller gets the guarantee without asking for it.
 *
 * Nothing in this file computes a `GoalSnapshot`, an orbit or a streak. An
 * asteroid has no period to close, so there is nothing for that machinery to
 * say about one.
 */

function toAsteroid(row: AsteroidRow): Asteroid {
	return {
		id: row.id,
		userId: row.userId,
		title: row.title,
		note: row.note,
		createdAt: row.createdAt,
		driftAnchorAt: row.driftAnchorAt,
		resolution: row.resolution as AsteroidResolution | null,
		resolvedAt: row.resolvedAt,
		capturedGoalId: row.capturedGoalId,
		captureDismissedAt: row.captureDismissedAt
	};
}

/** What is still on the belt, oldest drift anchor first. */
export async function listAsteroids(userId: string): Promise<Asteroid[]> {
	const rows = await db
		.select()
		.from(asteroids)
		.where(and(eq(asteroids.userId, userId), isNull(asteroids.resolution)));

	return sortBelt(rows.map(toAsteroid));
}

/**
 * One asteroid, under this user.
 *
 * Resolved rows come back too: capture is offered on the asteroid that was
 * just cleared, so the capture screen has to be able to load one.
 */
export async function getAsteroid(userId: string, id: string): Promise<Asteroid | null> {
	const [row] = await db
		.select()
		.from(asteroids)
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)))
		.limit(1);
	return row ? toAsteroid(row) : null;
}

export async function createAsteroid(userId: string, input: AsteroidInput): Promise<Asteroid> {
	const now = new Date();
	const row = {
		id: newId(),
		userId,
		title: input.title,
		note: input.note,
		createdAt: now,
		// The drift clock starts where the rock does, and moves only when the
		// title is rewritten. See `updateAsteroidTitle()`.
		driftAnchorAt: now,
		resolution: null,
		resolvedAt: null,
		capturedGoalId: null,
		captureDismissedAt: null
	};

	await db.insert(asteroids).values(row);
	return toAsteroid(row);
}

/**
 * Every asteroid this user has already resolved.
 *
 * Read whole rather than narrowed by title in SQL, because the recurrence
 * count matches on a Unicode case fold and SQLite's `lower()` only folds
 * ASCII — see the note on the table. Same bargain `loadForest()` strikes for
 * entries: correct now, and the thing to replace with a rollup on the day an
 * account has years of this behind it.
 */
async function resolvedAsteroids(userId: string): Promise<Asteroid[]> {
	const rows = await db
		.select()
		.from(asteroids)
		.where(and(eq(asteroids.userId, userId), isNotNull(asteroids.resolution)));
	return rows.map(toAsteroid);
}

/** A write that first had to find the row under this user. */
export type AsteroidWriteResult = { ok: true; asteroid: Asteroid } | { ok: false; missing: true };

/** Clearing also answers whether this title has earned the capture offer. */
export type ClearResult =
	{ ok: true; asteroid: Asteroid; offer: CaptureOffer } | { ok: false; missing: true };

async function resolve(
	userId: string,
	id: string,
	resolution: AsteroidResolution,
	extra: { capturedGoalId?: string } = {}
): Promise<Asteroid | null> {
	const existing = await getAsteroid(userId, id);
	// Only something still on the belt can leave it. A second submit of the
	// same clear — a double tap, a retried form post — finds the row already
	// resolved and changes nothing.
	if (!existing || existing.resolution) return null;

	const resolvedAt = new Date();
	await db
		.update(asteroids)
		.set({ resolution, resolvedAt, capturedGoalId: extra.capturedGoalId ?? null })
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)));

	return {
		...existing,
		resolution,
		resolvedAt,
		capturedGoalId: extra.capturedGoalId ?? null
	};
}

/**
 * Done. One tap, and quieter than a closing orbit — a revolution closing is
 * the biggest moment in the app and nothing else may compete with it.
 *
 * The answer carries the capture offer for this title, so the view that is
 * already showing "clean the garage — done" can ask whether it should be a
 * goal without a second round trip or a notification.
 */
export async function clearAsteroid(userId: string, id: string): Promise<ClearResult> {
	const cleared = await resolve(userId, id, 'cleared');
	if (!cleared) return { ok: false, missing: true };

	return {
		ok: true,
		asteroid: cleared,
		offer: captureOffer(cleared.title, await resolvedAsteroids(userId))
	};
}

/**
 * Let it go. A legitimate outcome, on the same footing as clearing — the row
 * stays (it is still the account's own data, and #17 exports it) but no view
 * queries for a released asteroid, because a "released" filter would only be
 * the backlog of guilt under a gentler name.
 */
export async function releaseAsteroid(userId: string, id: string): Promise<AsteroidWriteResult> {
	const released = await resolve(userId, id, 'released');
	return released ? { ok: true, asteroid: released } : { ok: false, missing: true };
}

/**
 * "No, this one really is a one-off."
 *
 * Stamped on the cleared row the offer was made against, which is the whole of
 * "don't ask again until the count restarts" — `captureOffer()` walks past it
 * on the next clear, and a release wipes it along with the count.
 */
export async function dismissCaptureOffer(
	userId: string,
	id: string
): Promise<AsteroidWriteResult> {
	const existing = await getAsteroid(userId, id);
	if (!existing) return { ok: false, missing: true };

	const captureDismissedAt = new Date();
	await db
		.update(asteroids)
		.set({ captureDismissedAt })
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)));

	return { ok: true, asteroid: { ...existing, captureDismissedAt } };
}

/**
 * Into orbit: the asteroid becomes a goal and records what it turned into.
 *
 * The goal is created by `createGoal()` rather than inserted here, so a
 * captured goal goes through the same validation, the same nesting rules and
 * the same sort order as one launched from the goal form — indistinguishable
 * from one created directly, because it is one.
 *
 * A cleared asteroid can still be captured: the offer fires on the clear
 * itself, so accepting it is always promoting a row that has just resolved.
 * One already captured or released is done, and comes back as missing.
 */
export async function captureAsteroid(
	userId: string,
	id: string,
	input: GoalInput
): Promise<GoalWriteResult> {
	const existing = await getAsteroid(userId, id);
	if (!existing) return { ok: false, missing: true };
	if (existing.resolution && existing.resolution !== 'cleared') {
		return { ok: false, missing: true };
	}

	const created = await createGoal(userId, input);
	if (!created.ok) return created;

	await db
		.update(asteroids)
		.set({
			resolution: 'captured',
			resolvedAt: new Date(),
			capturedGoalId: created.goal.id,
			// A capture answers the question the offer was asking, so the "don't
			// ask again" mark it may be carrying has nothing left to suppress.
			captureDismissedAt: null
		})
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)));

	return created;
}

/**
 * Rewrite the title, and move the drift clock with it.
 *
 * The one place `driftAnchorAt` is reassigned. Rewriting the title is
 * reconsidering what the rock is, which is exactly the moment its drift should
 * start again — and the comparison lives here rather than in the caller, so a
 * save that left the title alone cannot accidentally reset the clock.
 */
export async function updateAsteroidTitle(
	userId: string,
	id: string,
	title: string
): Promise<AsteroidWriteResult> {
	const existing = await getAsteroid(userId, id);
	if (!existing) return { ok: false, missing: true };
	if (existing.title === title) return { ok: true, asteroid: existing };

	const driftAnchorAt = new Date();
	await db
		.update(asteroids)
		.set({ title, driftAnchorAt })
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)));

	return { ok: true, asteroid: { ...existing, title, driftAnchorAt } };
}

/**
 * Amend the note, and leave the clock where it is.
 *
 * A separate function from the title so this one does not have to remember not
 * to touch the anchor: the note is detail hung off an identity rather than the
 * identity itself, and jotting one more sentence on a stale asteroid must not
 * quietly hide how stale it is.
 */
export async function updateAsteroidNote(
	userId: string,
	id: string,
	note: string | null
): Promise<AsteroidWriteResult> {
	const existing = await getAsteroid(userId, id);
	if (!existing) return { ok: false, missing: true };

	await db
		.update(asteroids)
		.set({ note })
		.where(and(eq(asteroids.id, id), eq(asteroids.userId, userId)));

	return { ok: true, asteroid: { ...existing, note } };
}
