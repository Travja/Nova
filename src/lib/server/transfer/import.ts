import { DEFAULT_PREFERENCES, mergePreferences, writePreferences } from '$domain/preferences';
import {
	entryKey,
	noteKey,
	planImport,
	readBundle,
	type AccountShape,
	type ImportMode,
	type ImportPlan,
	type ImportProblem,
	type MintId,
	type TransferTable
} from '$domain/transfer';
import { db } from '$lib/server/db';
import {
	asteroids,
	entries,
	goalArchiveWindows,
	goals,
	orbitNotes,
	reminderSettings,
	users
} from '$lib/server/db/schema';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';

/**
 * Import: validate, plan, then write the plan in one transaction.
 *
 * The dry run and the write are the same three calls — `readBundle()`,
 * `loadAccountShape()`, `planImport()` — and only `applyImport()` adds the
 * fourth. A summary produced any other way would be describing a program
 * nobody was about to run.
 *
 * Nothing is written outside `db.transaction`, so a bundle that fails halfway
 * leaves the account exactly as it was. Everything that decides *what* to
 * write is in `$domain/transfer` and has no database in it at all.
 *
 * Ownership lives here, as it does in every other service: the caller's id
 * scopes the shape that is loaded, the rows that replace deletes, and the rows
 * that are written. An id inside the file is never trusted — every one of them
 * is remapped on the way in.
 */

/**
 * The new id a bundle row is written under.
 *
 * A SHA-256 over the account, the table and the file's own id, cut to a
 * UUID-shaped string so it sits alongside `newId()`'s output without looking
 * like a different kind of thing.
 *
 * Deterministic rather than random, and that is the point: importing the same
 * file a second time mints the same ids, so every row collides with the one
 * already written and the merge adds nothing. Random ids would make a second
 * import a second copy of the account. It is scoped to the user so the same
 * file imported into two accounts produces two independent sets of rows, and
 * scoped to the table so two tables that happen to share a row id cannot
 * collide with each other.
 */
export function mintIdFor(userId: string): MintId {
	return (table, bundleId) => {
		const digest = createHash('sha256')
			.update(`${userId}\u0000${table}\u0000${bundleId}`)
			.digest('hex');
		return [
			digest.slice(0, 8),
			digest.slice(8, 12),
			digest.slice(12, 16),
			digest.slice(16, 20),
			digest.slice(20, 32)
		].join('-');
	};
}

/** What this account already holds, in the shape the planner asks questions of. */
export async function loadAccountShape(userId: string): Promise<AccountShape> {
	const goalRows = await db
		.select({ id: goals.id, sortOrder: goals.sortOrder })
		.from(goals)
		.where(eq(goals.userId, userId));

	const windowRows = await db
		.select({ id: goalArchiveWindows.id })
		.from(goalArchiveWindows)
		.innerJoin(goals, eq(goalArchiveWindows.goalId, goals.id))
		.where(eq(goals.userId, userId));

	// Only the pair the unique index is on; the rest of an entry says nothing
	// about whether this one is already here.
	const entryRows = await db
		.select({ goalId: entries.goalId, clientId: entries.clientId })
		.from(entries)
		.innerJoin(goals, eq(entries.goalId, goals.id))
		.where(eq(goals.userId, userId));

	const noteRows = await db
		.select({ goalId: orbitNotes.goalId, periodKey: orbitNotes.periodKey })
		.from(orbitNotes)
		.innerJoin(goals, eq(orbitNotes.goalId, goals.id))
		.where(eq(goals.userId, userId));

	const asteroidRows = await db
		.select({ id: asteroids.id })
		.from(asteroids)
		.where(eq(asteroids.userId, userId));

	const [reminders] = await db
		.select({ userId: reminderSettings.userId })
		.from(reminderSettings)
		.where(eq(reminderSettings.userId, userId))
		.limit(1);

	const counts: Record<TransferTable, number> = {
		goals: goalRows.length,
		goalArchiveWindows: windowRows.length,
		entries: entryRows.length,
		asteroids: asteroidRows.length,
		orbitNotes: noteRows.length
	};

	return {
		goalIds: new Set(goalRows.map((goal) => goal.id)),
		archiveWindowIds: new Set(windowRows.map((window) => window.id)),
		entryKeys: new Set(
			entryRows
				.filter((entry) => entry.clientId !== null)
				.map((entry) => entryKey(entry.goalId, entry.clientId as string))
		),
		asteroidIds: new Set(asteroidRows.map((rock) => rock.id)),
		noteKeys: new Set(noteRows.map((note) => noteKey(note.goalId, note.periodKey))),
		hasReminderSettings: reminders !== undefined,
		highestSortOrder: goalRows.reduce((highest, goal) => Math.max(highest, goal.sortOrder), -1),
		counts
	};
}

export type ImportOutcome = { ok: true; plan: ImportPlan } | { ok: false; problem: ImportProblem };

/**
 * Read a file and say what importing it would do. Writes nothing.
 *
 * The plan it returns is the same object `applyImport()` hands to the writer,
 * which is what makes the summary on screen a description of the write that is
 * about to happen rather than of one like it.
 */
export async function previewImport(
	userId: string,
	source: string,
	mode: ImportMode
): Promise<ImportOutcome> {
	const read = readBundle(source);
	if (!read.ok) return { ok: false, problem: read.problem };

	const account = await loadAccountShape(userId);
	const planned = planImport(read.bundle, account, { mode, mintId: mintIdFor(userId) });
	if (!planned.ok) return { ok: false, problem: planned.problem };

	return { ok: true, plan: planned.plan };
}

/**
 * Plan the same way, then write it.
 *
 * The plan is built before the transaction opens because loading the account's
 * shape is a handful of queries and `better-sqlite3` transactions are
 * synchronous. Nothing rests on the two being one atomic step: every insert
 * carries `onConflictDoNothing`, so a row that arrived between the plan and the
 * write — an offline entry landing mid-import, say — is skipped rather than
 * raising, and the counts in the summary are the only thing that can be a
 * little stale.
 */
export async function applyImport(
	userId: string,
	source: string,
	mode: ImportMode
): Promise<ImportOutcome> {
	const planned = await previewImport(userId, source, mode);
	if (!planned.ok) return planned;

	const { plan } = planned;

	db.transaction((tx) => {
		if (plan.wipeFirst) {
			// Asteroids first: they point at goals, and dropping the rows rather
			// than letting `set null` run is one less thing for the delete of the
			// goals to do. Everything under a goal — archive windows, entries,
			// notes — goes with the goal, by cascade.
			tx.delete(asteroids).where(eq(asteroids.userId, userId)).run();
			tx.delete(goals).where(eq(goals.userId, userId)).run();
			tx.delete(reminderSettings).where(eq(reminderSettings.userId, userId)).run();
		}

		if (plan.profile) {
			tx.update(users)
				.set({
					displayName: plan.profile.displayName,
					timeZone: plan.profile.timeZone,
					weekStartsOn: plan.profile.weekStartsOn,
					preferences: plan.profile.preferences
						? writePreferences(mergePreferences(DEFAULT_PREFERENCES, plan.profile.preferences))
						: null
				})
				.where(eq(users.id, userId))
				.run();
		}

		// Parents first, so the self-reference on `goals.parent_id` always has
		// something to point at. `planImport()` ordered them.
		for (const goal of plan.goals) {
			tx.insert(goals)
				.values({ ...goal, userId })
				.onConflictDoNothing()
				.run();
		}

		for (const window of plan.archiveWindows) {
			tx.insert(goalArchiveWindows).values(window).onConflictDoNothing().run();
		}

		for (const entry of plan.entries) {
			/*
			 * The pair, not the primary key. `entries_goal_client_unique` is what
			 * already stops the offline queue, the `online` listener and the
			 * service worker counting one log three times, and it is the same
			 * index that makes a repeated merge add nothing — an entry that had no
			 * client id was given a deterministic one on the way in, because
			 * SQLite counts every null as distinct and those would otherwise land
			 * again on every import.
			 */
			tx.insert(entries)
				.values(entry)
				.onConflictDoNothing({ target: [entries.goalId, entries.clientId] })
				.run();
		}

		for (const rock of plan.asteroids) {
			tx.insert(asteroids)
				.values({ ...rock, userId })
				.onConflictDoNothing()
				.run();
		}

		for (const note of plan.orbitNotes) {
			tx.insert(orbitNotes).values(note).onConflictDoNothing().run();
		}

		if (plan.reminderSettings) {
			tx.insert(reminderSettings)
				.values({ ...plan.reminderSettings, userId, lastSentAt: null })
				.onConflictDoNothing()
				.run();
		}
	});

	return { ok: true, plan };
}
