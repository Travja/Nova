import { db } from '$lib/server/db';
import { goals, orbitNotes, type OrbitNoteRow } from '$lib/server/db/schema';
import { newId } from '$lib/server/auth/session';
import { and, eq } from 'drizzle-orm';

/**
 * Notes on an orbit's period — see #18.
 *
 * Deliberately does not import from `$lib/server/goals`: that module comes to
 * import `notesForGoal` to build a history page, and a two-way import would
 * make a cycle of it. Ownership is checked the same way `logEntry()` does —
 * re-read under the caller's id — just against the `goals` table directly
 * rather than through `getGoal()`.
 */

export interface OrbitNote {
	id: string;
	goalId: string;
	periodKey: string;
	periodStart: Date;
	body: string;
	createdAt: Date;
	updatedAt: Date;
}

function toOrbitNote(row: OrbitNoteRow): OrbitNote {
	return {
		id: row.id,
		goalId: row.goalId,
		periodKey: row.periodKey,
		periodStart: row.periodStart,
		body: row.body,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

async function ownsGoal(userId: string, goalId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: goals.id })
		.from(goals)
		.where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
		.limit(1);
	return row !== undefined;
}

/**
 * Every note on this goal, keyed by period — ready to hand to `historyCells()`
 * the way `detailsByPeriod` already is. `OrbitNote` carries more fields than
 * `$domain/history`'s own `OrbitNote`, but is a structural superset of it, so
 * the map passes straight through.
 */
export async function notesForGoal(
	userId: string,
	goalId: string
): Promise<Map<string, OrbitNote>> {
	if (!(await ownsGoal(userId, goalId))) return new Map();

	const rows = await db.select().from(orbitNotes).where(eq(orbitNotes.goalId, goalId));
	return new Map(rows.map((row) => [row.periodKey, toOrbitNote(row)]));
}

export type OrbitNoteResult = { ok: true; note: OrbitNote | null } | { ok: false; missing: true };

/**
 * Upsert on the `(goalId, periodKey)` pair, so editing an existing note is the
 * same call as writing the first one.
 *
 * A trimmed-empty body deletes rather than storing `''` — `note` comes back
 * `null` in that case, same shape a fresh read would give.
 */
export async function writeOrbitNote(
	userId: string,
	goalId: string,
	input: { periodKey: string; periodStart: Date; body: string }
): Promise<OrbitNoteResult> {
	if (!(await ownsGoal(userId, goalId))) return { ok: false, missing: true };

	if (!input.body) {
		await deleteOrbitNote(userId, goalId, input.periodKey);
		return { ok: true, note: null };
	}

	const now = new Date();
	await db
		.insert(orbitNotes)
		.values({
			id: newId(),
			goalId,
			periodKey: input.periodKey,
			periodStart: input.periodStart,
			body: input.body,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [orbitNotes.goalId, orbitNotes.periodKey],
			set: { periodStart: input.periodStart, body: input.body, updatedAt: now }
		});

	const [saved] = await db
		.select()
		.from(orbitNotes)
		.where(and(eq(orbitNotes.goalId, goalId), eq(orbitNotes.periodKey, input.periodKey)))
		.limit(1);
	return saved ? { ok: true, note: toOrbitNote(saved) } : { ok: false, missing: true };
}

/** Clear a note outright — the path the history page's "Clear" control takes. */
export async function deleteOrbitNote(
	userId: string,
	goalId: string,
	periodKey: string
): Promise<boolean> {
	if (!(await ownsGoal(userId, goalId))) return false;

	const result = await db
		.delete(orbitNotes)
		.where(and(eq(orbitNotes.goalId, goalId), eq(orbitNotes.periodKey, periodKey)));
	return result.changes > 0;
}
