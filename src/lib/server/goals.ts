import { snapshotGoal, type GoalSnapshot } from '$domain/progress';
import type { Goal, ProgressEntry } from '$domain/types';
import type { GoalInput } from '$domain/validation';
import { db } from '$lib/server/db';
import { entries, goals, type EntryRow, type GoalRow } from '$lib/server/db/schema';
import type { SessionUser } from '$lib/server/auth/session';
import { newId } from '$lib/server/auth/session';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tier } from '$domain/tiers';
import type { MetricKind } from '$domain/types';

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

	return owned.map((goal) =>
		snapshotGoal(goal, byGoal.get(goal.id) ?? [], { ...periodOptions(user), now })
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

	return {
		snapshot: snapshotGoal(goal, all, { ...periodOptions(user), now }),
		recentEntries
	};
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

export async function setGoalArchived(
	userId: string,
	goalId: string,
	archived: boolean
): Promise<boolean> {
	const result = await db
		.update(goals)
		.set({ archivedAt: archived ? new Date() : null })
		.where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
	return result.changes > 0;
}

export async function deleteGoal(userId: string, goalId: string): Promise<boolean> {
	const result = await db.delete(goals).where(and(eq(goals.id, goalId), eq(goals.userId, userId)));
	return result.changes > 0;
}

export async function logEntry(
	userId: string,
	goalId: string,
	input: { amount: number; note: string | null; occurredAt?: Date }
): Promise<ProgressEntry | null> {
	// Ownership is checked here rather than trusted from the route, so every
	// caller gets the same guarantee.
	const goal = await getGoal(userId, goalId);
	if (!goal) return null;

	const row = {
		id: newId(),
		goalId,
		amount: input.amount,
		note: input.note,
		occurredAt: input.occurredAt ?? new Date(),
		createdAt: new Date()
	};
	await db.insert(entries).values(row);
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
