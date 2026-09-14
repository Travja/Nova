import {
	buildOrbit,
	snapshotGoal,
	type DormantWindow,
	type GoalSnapshot,
	type Orbit
} from '$domain/progress';
import type { Goal, ProgressEntry } from '$domain/types';
import type { GoalInput } from '$domain/validation';
import { db } from '$lib/server/db';
import {
	entries,
	goalArchiveWindows,
	goals,
	type EntryRow,
	type GoalRow
} from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth/session';
import { newId } from '$lib/server/auth/session';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { cadenceOf, type Tier } from '$domain/tiers';
import type { MetricKind } from '$domain/types';
import { periodFor, type Period } from '$domain/period';

function toGoal(row: GoalRow): Goal {
	return {
		id: row.id,
		userId: row.userId,
		title: row.title,
		description: row.description,
		tier: row.tier as Tier,
		metric: { kind: row.metricKind as MetricKind, unit: row.metricUnit },
		target: row.target,
		color: row.color,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		archivedAt: row.archivedAt
	};
}

function toEntry(row: EntryRow): ProgressEntry {
	return {
		id: row.id,
		goalId: row.goalId,
		amount: row.amount,
		note: row.note,
		occurredAt: row.occurredAt,
		createdAt: row.createdAt
	};
}

function periodOptions(user: SessionUser) {
	return { timeZone: user.timeZone, weekStartsOn: user.weekStartsOn };
}

/** The spans each of these goals spent archived, keyed by goal id. */
async function dormantWindowsFor(goalIds: string[]): Promise<Map<string, DormantWindow[]>> {
	const byGoal = new Map<string, DormantWindow[]>();
	if (goalIds.length === 0) return byGoal;

	const rows = await db
		.select()
		.from(goalArchiveWindows)
		.where(inArray(goalArchiveWindows.goalId, goalIds));

	for (const row of rows) {
		const window = { from: row.archivedAt, until: row.restoredAt };
		const bucket = byGoal.get(row.goalId);
		if (bucket) bucket.push(window);
		else byGoal.set(row.goalId, [window]);
	}
	return byGoal;
}

export async function listGoals(userId: string, includeArchived = false): Promise<Goal[]> {
	const rows = await db
		.select()
		.from(goals)
		.where(
			includeArchived
				? eq(goals.userId, userId)
				: and(eq(goals.userId, userId), isNull(goals.archivedAt))
		)
		.orderBy(asc(goals.sortOrder), asc(goals.createdAt));
	return rows.map(toGoal);
}

/**
 * Every goal the user owns, each with its orbits computed.
 *
 * Entries are loaded in full because lifetime orbit counts depend on all of
 * them; once a user has years of history this wants a rollup table instead.
 */
export async function listGoalSnapshots(
	user: SessionUser,
	now = new Date()
): Promise<GoalSnapshot[]> {
	const owned = await listGoals(user.id);
	if (owned.length === 0) return [];

	const rows = await db
		.select()
		.from(entries)
		.where(
			inArray(
				entries.goalId,
				owned.map((goal) => goal.id)
			)
		);

	const byGoal = new Map<string, ProgressEntry[]>();
	for (const row of rows) {
		const entry = toEntry(row);
		const bucket = byGoal.get(entry.goalId);
		if (bucket) bucket.push(entry);
		else byGoal.set(entry.goalId, [entry]);
	}

	const dormant = await dormantWindowsFor(owned.map((goal) => goal.id));

	return owned.map((goal) =>
		snapshotGoal(goal, byGoal.get(goal.id) ?? [], {
			...periodOptions(user),
			now,
			dormantWindows: dormant.get(goal.id) ?? []
		})
	);
}

/**
 * Archived goals with their final numbers.
 *
 * Each one is snapshotted as of the instant it was archived, so the listing
 * shows the orbit it stopped on rather than a row of empty periods it was
 * never awake for.
 */
export async function listArchivedSnapshots(user: SessionUser): Promise<GoalSnapshot[]> {
	const rows = await db
		.select()
		.from(goals)
		.where(and(eq(goals.userId, user.id), isNotNull(goals.archivedAt)))
		.orderBy(desc(goals.archivedAt));
	const archived = rows.map(toGoal);
	if (archived.length === 0) return [];

	const entryRows = await db
		.select()
		.from(entries)
		.where(
			inArray(
				entries.goalId,
				archived.map((goal) => goal.id)
			)
		);

	const byGoal = new Map<string, ProgressEntry[]>();
	for (const row of entryRows) {
		const entry = toEntry(row);
		const bucket = byGoal.get(entry.goalId);
		if (bucket) bucket.push(entry);
		else byGoal.set(entry.goalId, [entry]);
	}

	const dormant = await dormantWindowsFor(archived.map((goal) => goal.id));

	return archived.map((goal) =>
		snapshotGoal(goal, byGoal.get(goal.id) ?? [], {
			...periodOptions(user),
			now: goal.archivedAt ?? new Date(),
			dormantWindows: dormant.get(goal.id) ?? []
		})
	);
}

export async function getGoal(userId: string, goalId: string): Promise<Goal | null> {
	const [row] = await db
		.select()
		.from(goals)
		.where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
		.limit(1);
	return row ? toGoal(row) : null;
}

export async function getGoalDetail(
	user: SessionUser,
	goalId: string,
	now = new Date()
): Promise<{ snapshot: GoalSnapshot; recentEntries: ProgressEntry[] } | null> {
	const goal = await getGoal(user.id, goalId);
	if (!goal) return null;

	const rows = await db.select().from(entries).where(eq(entries.goalId, goalId));
	const all = rows.map(toEntry);
	const recentEntries = [...all]
		.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
		.slice(0, 50);

	const dormant = await dormantWindowsFor([goal.id]);

	return {
		snapshot: snapshotGoal(goal, all, {
			...periodOptions(user),
			// An archived goal is frozen at the moment it was archived.
			now: goal.archivedAt ?? now,
			dormantWindows: dormant.get(goal.id) ?? []
		}),
		recentEntries
	};
}

/**
 * The orbit a single instant belongs to, with only that period's entries read.
 *
 * Backdating needs to report which orbit moved, and that orbit is often older
 * than the history the dashboard carries.
 */
export async function orbitAt(
	user: SessionUser,
	goalId: string,
	instant: Date
): Promise<{ orbit: Orbit; period: Period } | null> {
	const goal = await getGoal(user.id, goalId);
	if (!goal) return null;

	const period = periodFor(instant, cadenceOf(goal.tier), periodOptions(user));
	const [{ logged }] = await db
		.select({ logged: sql<number>`coalesce(sum(${entries.amount}), 0)` })
		.from(entries)
		.where(
			and(
				eq(entries.goalId, goalId),
				gte(entries.occurredAt, period.start),
				lt(entries.occurredAt, period.end)
			)
		);

	return { orbit: buildOrbit(period, logged, goal.target), period };
}

export async function createGoal(userId: string, input: GoalInput): Promise<Goal> {
	const [{ nextOrder }] = await db
		.select({ nextOrder: sql<number>`coalesce(max(${goals.sortOrder}), -1) + 1` })
		.from(goals)
		.where(eq(goals.userId, userId));

	const row = {
		id: newId(),
		userId,
		title: input.title,
		description: input.description,
		tier: input.tier,
		metricKind: input.metricKind,
		metricUnit: input.metricUnit,
		target: input.target,
		color: input.color,
		sortOrder: nextOrder,
		createdAt: new Date(),
		archivedAt: null
	};
	await db.insert(goals).values(row);
	return toGoal(row);
}

export async function updateGoal(
	userId: string,
	goalId: string,
	input: GoalInput
): Promise<boolean> {
	const result = await db
		.update(goals)
		.set({
			title: input.title,
			description: input.description,
			tier: input.tier,
			metricKind: input.metricKind,
			metricUnit: input.metricUnit,
			target: input.target,
			color: input.color
		})
		.where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
	return result.changes > 0;
}

/**
 * Archive or restore, recording the dormant span either way.
 *
 * The update only matches a goal already in the opposite state, so a double
 * submit cannot open two windows, and the window row travels with it in the
 * same transaction — a half-written pair would leave orbits dormant forever.
 */
export async function setGoalArchived(
	userId: string,
	goalId: string,
	archived: boolean
): Promise<boolean> {
	const now = new Date();
	return db.transaction((tx) => {
		const result = tx
			.update(goals)
			.set({ archivedAt: archived ? now : null })
			.where(
				and(
					eq(goals.id, goalId),
					eq(goals.userId, userId),
					archived ? isNull(goals.archivedAt) : isNotNull(goals.archivedAt)
				)
			)
			.run();
		if (result.changes === 0) return false;

		if (archived) {
			tx.insert(goalArchiveWindows)
				.values({ id: newId(), goalId, archivedAt: now, restoredAt: null })
				.run();
		} else {
			tx.update(goalArchiveWindows)
				.set({ restoredAt: now })
				.where(and(eq(goalArchiveWindows.goalId, goalId), isNull(goalArchiveWindows.restoredAt)))
				.run();
		}
		return true;
	});
}

/**
 * Persist a new order for one tier's goals.
 *
 * Goals are grouped by tier before they are drawn, so only the order within a
 * tier is ever visible; renumbering from the tier's own lowest slot keeps the
 * values distinct without touching anything else the user owns.
 */
export async function reorderGoals(
	userId: string,
	tier: Tier,
	orderedIds: readonly string[]
): Promise<boolean> {
	const inTier = (await listGoals(userId)).filter((goal) => goal.tier === tier);
	const ids = new Set(inTier.map((goal) => goal.id));
	if (orderedIds.length === 0 || orderedIds.length !== ids.size) return false;
	if (!orderedIds.every((id) => ids.has(id))) return false;

	const base = Math.min(...inTier.map((goal) => goal.sortOrder));
	db.transaction((tx) => {
		orderedIds.forEach((id, index) => {
			tx.update(goals)
				.set({ sortOrder: base + index })
				.where(and(eq(goals.id, id), eq(goals.userId, userId)))
				.run();
		});
	});
	return true;
}

/** Move one goal a single place within its tier — the keyboard route to reordering. */
export async function moveGoal(userId: string, goalId: string, delta: -1 | 1): Promise<boolean> {
	const owned = await listGoals(userId);
	const goal = owned.find((candidate) => candidate.id === goalId);
	if (!goal) return false;

	const ids = owned.filter((candidate) => candidate.tier === goal.tier).map((each) => each.id);
	const from = ids.indexOf(goalId);
	const to = from + delta;
	if (to < 0 || to >= ids.length) return false;

	[ids[from], ids[to]] = [ids[to], ids[from]];
	return reorderGoals(userId, goal.tier, ids);
}

export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
	const result = await db.delete(goals).where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
	return result.changes > 0;
}

/**
 * Record an entry against a goal the user owns.
 *
 * Pass `clientId` — the id the browser gave the entry before it was first sent
 * — and the insert becomes idempotent: a second arrival of the same entry
 * conflicts on `entries_goal_client_unique` and the row already written is
 * returned instead. That is the whole guarantee behind offline logging, and it
 * is a constraint rather than a read-then-write check on purpose, because two
 * retries in flight at once would both read "not there yet" and both insert.
 *
 * Everything else about a queued entry is treated exactly like a live one: the
 * goal is re-read under this user's id here rather than trusted from the route,
 * so arriving late buys an entry no authority it did not have when it was made.
 */
export async function logEntry(
	userId: string,
	goalId: string,
	input: { amount: number; note: string | null; occurredAt?: Date; clientId?: string }
): Promise<ProgressEntry | null> {
	// An archived goal is dormant: restoring it is the way back to logging.
	const goal = await getGoal(userId, goalId);
	if (!goal || goal.archivedAt) return null;

	const clientId = input.clientId ?? null;
	const row = {
		id: newId(),
		goalId,
		amount: input.amount,
		note: input.note,
		occurredAt: input.occurredAt ?? new Date(),
		createdAt: new Date(),
		clientId
	};

	if (!clientId) {
		await db.insert(entries).values(row);
		return toEntry(row);
	}

	const result = await db
		.insert(entries)
		.values(row)
		.onConflictDoNothing({ target: [entries.goalId, entries.clientId] });
	if (result.changes > 0) return toEntry(row);

	// The entry landed on an earlier attempt whose answer never arrived. Hand
	// back what was written then, so the caller sees a success rather than
	// retrying forever against a constraint it cannot satisfy.
	const [existing] = await db
		.select()
		.from(entries)
		.where(and(eq(entries.goalId, goalId), eq(entries.clientId, clientId)))
		.limit(1);
	return existing ? toEntry(existing) : null;
}

/**
 * Edit an entry's amount, note and timestamp.
 *
 * The goal is re-read under the user's id exactly as `logEntry()` does, so an
 * entry id alone is never enough to move someone else's history.
 */
export async function updateEntry(
	userId: string,
	goalId: string,
	entryId: string,
	input: { amount: number; note: string | null; occurredAt?: Date }
): Promise<ProgressEntry | null> {
	const goal = await getGoal(userId, goalId);
	if (!goal || goal.archivedAt) return null;

	const [existing] = await db
		.select()
		.from(entries)
		.where(and(eq(entries.id, entryId), eq(entries.goalId, goalId)))
		.limit(1);
	if (!existing) return null;

	const row = {
		...existing,
		amount: input.amount,
		note: input.note,
		occurredAt: input.occurredAt ?? existing.occurredAt
	};
	await db
		.update(entries)
		.set({ amount: row.amount, note: row.note, occurredAt: row.occurredAt })
		.where(eq(entries.id, entryId));
	return toEntry(row);
}

export async function deleteEntry(userId: string, entryId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: entries.id })
		.from(entries)
		.innerJoin(goals, eq(entries.goalId, goals.id))
		.where(and(eq(entries.id, entryId), eq(goals.userId, userId)))
		.limit(1);
	if (!row) return false;

	const result = await db.delete(entries).where(eq(entries.id, entryId));
	return result.changes > 0;
}

export async function latestEntries(userId: string, limit = 10): Promise<ProgressEntry[]> {
	const rows = await db
		.select({ entry: entries })
		.from(entries)
		.innerJoin(goals, eq(entries.goalId, goals.id))
		.where(eq(goals.userId, userId))
		.orderBy(desc(entries.occurredAt))
		.limit(limit);
	return rows.map((row) => toEntry(row.entry));
}
