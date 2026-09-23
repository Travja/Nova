import { bundleSchema, TRANSFER_SCHEMA_VERSION, type Bundle } from '$domain/transfer';
import { db } from '$lib/server/db';
import {
	asteroids,
	entries,
	goalArchiveWindows,
	goals,
	orbitNotes,
	users
} from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * The export, built from an allowlist of columns.
 *
 * Note what this file does not query. There is no select against `users`
 * beyond checking the account still exists, and none at all against
 * `sessions`, `password_reset_tokens`, `push_subscriptions` or
 * `reminder_settings`. An export says what the goals were, never whose they
 * were, so the tables that could leak an account are not read in the first
 * place — which is a stronger guarantee than reading them and remembering to
 * drop the wrong columns.
 *
 * What is left names its columns anyway. `select *` minus a deny-list ships
 * whatever column is added next, and the file lands in a Downloads folder and
 * is often mailed onwards, so what is absent matters more than what is present.
 *
 * `bundleSchema.parse()` at the end is the second half of the same guarantee.
 * Zod strips what it does not declare, so a column that finds its way into one
 * of these projections without being declared in `$domain/transfer` never
 * reaches the string that is written to disk.
 *
 * Ownership is checked in the queries themselves: the three goal-owned tables
 * join back to `goals` and filter on the user, rather than trusting a list of
 * ids assembled somewhere else.
 */

/** Epoch milliseconds, which is how every timestamp travels. */
function at(value: Date): number {
	return value.getTime();
}

function atOrNull(value: Date | null): number | null {
	return value === null ? null : value.getTime();
}

/**
 * Every goal and asteroid the account owns, as one bundle — or null when there
 * is no such user, which only happens if the account was deleted mid-request.
 */
export async function exportBundle(
	userId: string,
	exportedAt: Date = new Date()
): Promise<Bundle | null> {
	// The id and nothing else: this asks whether the account is still there, so
	// a download that raced a delete is a 404 rather than an empty file. No
	// column of `users` reaches the bundle.
	const [account] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	if (!account) return null;

	const goalRows = await db
		.select({
			id: goals.id,
			title: goals.title,
			description: goals.description,
			tier: goals.tier,
			metricKind: goals.metricKind,
			metricUnit: goals.metricUnit,
			target: goals.target,
			color: goals.color,
			sortOrder: goals.sortOrder,
			createdAt: goals.createdAt,
			archivedAt: goals.archivedAt,
			parentId: goals.parentId
		})
		.from(goals)
		.where(eq(goals.userId, userId));

	const windowRows = await db
		.select({
			id: goalArchiveWindows.id,
			goalId: goalArchiveWindows.goalId,
			archivedAt: goalArchiveWindows.archivedAt,
			restoredAt: goalArchiveWindows.restoredAt
		})
		.from(goalArchiveWindows)
		.innerJoin(goals, eq(goalArchiveWindows.goalId, goals.id))
		.where(eq(goals.userId, userId));

	const entryRows = await db
		.select({
			id: entries.id,
			goalId: entries.goalId,
			amount: entries.amount,
			note: entries.note,
			occurredAt: entries.occurredAt,
			createdAt: entries.createdAt,
			clientId: entries.clientId
		})
		.from(entries)
		.innerJoin(goals, eq(entries.goalId, goals.id))
		.where(eq(goals.userId, userId));

	const noteRows = await db
		.select({
			id: orbitNotes.id,
			goalId: orbitNotes.goalId,
			periodKey: orbitNotes.periodKey,
			periodStart: orbitNotes.periodStart,
			body: orbitNotes.body,
			createdAt: orbitNotes.createdAt,
			updatedAt: orbitNotes.updatedAt
		})
		.from(orbitNotes)
		.innerJoin(goals, eq(orbitNotes.goalId, goals.id))
		.where(eq(goals.userId, userId));

	const asteroidRows = await db
		.select({
			id: asteroids.id,
			title: asteroids.title,
			note: asteroids.note,
			createdAt: asteroids.createdAt,
			driftAnchorAt: asteroids.driftAnchorAt,
			resolution: asteroids.resolution,
			resolvedAt: asteroids.resolvedAt,
			capturedGoalId: asteroids.capturedGoalId,
			captureDismissedAt: asteroids.captureDismissedAt
		})
		.from(asteroids)
		.where(eq(asteroids.userId, userId));

	return bundleSchema.parse({
		schemaVersion: TRANSFER_SCHEMA_VERSION,
		exportedAt: at(exportedAt),
		goals: goalRows.map((goal) => ({
			...goal,
			createdAt: at(goal.createdAt),
			archivedAt: atOrNull(goal.archivedAt)
		})),
		goalArchiveWindows: windowRows.map((window) => ({
			...window,
			archivedAt: at(window.archivedAt),
			restoredAt: atOrNull(window.restoredAt)
		})),
		entries: entryRows.map((entry) => ({
			...entry,
			occurredAt: at(entry.occurredAt),
			createdAt: at(entry.createdAt)
		})),
		asteroids: asteroidRows.map((rock) => ({
			...rock,
			createdAt: at(rock.createdAt),
			driftAnchorAt: at(rock.driftAnchorAt),
			resolvedAt: atOrNull(rock.resolvedAt),
			captureDismissedAt: atOrNull(rock.captureDismissedAt)
		})),
		orbitNotes: noteRows.map((note) => ({
			...note,
			periodStart: at(note.periodStart),
			createdAt: at(note.createdAt),
			updatedAt: at(note.updatedAt)
		}))
	});
}

/** `nova-export-2026-09-22.json` — dated in UTC, same as everything stored. */
export function bundleFilename(exportedAt: Date = new Date()): string {
	return `nova-export-${exportedAt.toISOString().slice(0, 10)}.json`;
}

/** The bundle as the bytes that are downloaded. Indented: this is meant to be read. */
export function serializeBundle(bundle: Bundle): string {
	return `${JSON.stringify(bundle, null, '\t')}\n`;
}
