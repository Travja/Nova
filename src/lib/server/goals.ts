import {
	buildOrbit,
	flightAnchor,
	type DormantWindow,
	type GoalSnapshot,
	type Orbit
} from '$domain/progress';
import {
	childrenOf,
	closedPeriods,
	ORBIT_METRIC,
	parentProblem,
	restDayCapacity,
	snapshotWithChildren,
	tierProblem,
	type ChildInput,
	type ParentProblem
} from '$domain/nesting';
import { finalRecord, periodsSinceLaunch, type FinalRecord } from '$domain/stats';
import {
	endUnder,
	goalStatus,
	isFinished,
	isFlying,
	outlives,
	recordInstant,
	resolveEnd,
	type EndProblem
} from '$domain/ending';
import {
	detailsFromClosures,
	detailsFromEntries,
	historyCells,
	HISTORY_PAGE_LENGTH,
	type HistoryCell
} from '$domain/history';
import type { Goal, MetricDefinition, ProgressEntry } from '$domain/types';
import type { GoalInput } from '$domain/validation';
import { notesForGoal, notesForUser, type OrbitNote } from '$lib/server/orbit-notes';
import { db } from '$lib/server/db';
import {
	entries,
	goalArchiveWindows,
	goalSchedules,
	goals,
	type EntryRow,
	type GoalRow
} from '$lib/server/db/schema';
import { scheduleChange, type RestSchedule } from '$domain/schedule';
import type { SessionUser } from '$lib/server/auth/session';
import { newId } from '$lib/server/auth/session';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { cadenceOf, TIERS, type Tier } from '$domain/tiers';
import type { MetricKind } from '$domain/types';
import { periodFor, type Period, type PeriodOptions } from '$domain/period';

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
		archivedAt: row.archivedAt,
		endsAt: row.endsAt,
		parentId: row.parentId
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

/** Each of these goals' rest-day schedule spans, keyed by goal id. */
async function restSchedulesFor(goalIds: string[]): Promise<Map<string, RestSchedule[]>> {
	const byGoal = new Map<string, RestSchedule[]>();
	if (goalIds.length === 0) return byGoal;

	const rows = await db
		.select()
		.from(goalSchedules)
		.where(inArray(goalSchedules.goalId, goalIds))
		.orderBy(asc(goalSchedules.from));

	for (const row of rows) {
		const schedule = { from: row.from, restDays: row.restDays };
		const bucket = byGoal.get(row.goalId);
		if (bucket) bucket.push(schedule);
		else byGoal.set(row.goalId, [schedule]);
	}
	return byGoal;
}

/**
 * Everything a user's goal trees are computed from, loaded once.
 *
 * Nesting is resolved over goals that are already in memory — `$domain/nesting`
 * never reads a database — so the service's job is to load the shape and hand
 * it over. Archived goals are included: a child parked last week still closed
 * the weeks before it, and its dormant windows are what stop it counting for
 * the weeks since.
 */
interface Forest {
	goals: Goal[];
	entriesByGoal: Map<string, ProgressEntry[]>;
	dormantByGoal: Map<string, DormantWindow[]>;
	schedulesByGoal: Map<string, RestSchedule[]>;
}

function bucketEntries(rows: EntryRow[]): Map<string, ProgressEntry[]> {
	const byGoal = new Map<string, ProgressEntry[]>();
	for (const row of rows) {
		const entry = toEntry(row);
		const bucket = byGoal.get(entry.goalId);
		if (bucket) bucket.push(entry);
		else byGoal.set(entry.goalId, [entry]);
	}
	return byGoal;
}

/** Every goal the user owns, with its entries, dormant windows and rest-day schedules. */
async function loadForest(userId: string): Promise<Forest> {
	const all = await listGoals(userId, true);
	if (all.length === 0) {
		return {
			goals: [],
			entriesByGoal: new Map(),
			dormantByGoal: new Map(),
			schedulesByGoal: new Map()
		};
	}

	const ids = all.map((goal) => goal.id);
	const rows = await db.select().from(entries).where(inArray(entries.goalId, ids));

	return {
		goals: all,
		entriesByGoal: bucketEntries(rows),
		dormantByGoal: await dormantWindowsFor(ids),
		schedulesByGoal: await restSchedulesFor(ids)
	};
}

/**
 * The ladder is five tiers and every edge is strictly longer than the one
 * below, so a chain cannot be longer than five. Validation refuses a cycle at
 * write time; this is the belt that means a database which somehow holds one
 * still renders a page rather than overflowing a stack.
 */
const MAX_TREE_DEPTH = TIERS.length;

/** One goal's direct children, and theirs, as the domain wants them. */
function childInputs(goalId: string, forest: Forest, depth = 0): ChildInput[] {
	if (depth >= MAX_TREE_DEPTH) return [];
	return childrenOf(goalId, forest.goals).map((child) => ({
		goal: child,
		entries: forest.entriesByGoal.get(child.id) ?? [],
		dormantWindows: forest.dormantByGoal.get(child.id) ?? [],
		restSchedules: forest.schedulesByGoal.get(child.id) ?? [],
		children: childInputs(child.id, forest, depth + 1)
	}));
}

/**
 * A goal's snapshot from a loaded forest — derived when it has children, and
 * exactly what `snapshotGoal()` always gave when it does not.
 *
 * Every screen goes through here rather than calling either one directly, which
 * is what keeps "having children is what makes a goal derived" a single fact.
 */
function snapshotFromForest(
	goal: Goal,
	forest: Forest,
	user: SessionUser,
	now: Date,
	historyLength?: number
): GoalSnapshot {
	return snapshotWithChildren(
		goal,
		forest.entriesByGoal.get(goal.id) ?? [],
		childInputs(goal.id, forest),
		{
			...periodOptions(user),
			now,
			historyLength,
			dormantWindows: forest.dormantByGoal.get(goal.id) ?? [],
			restSchedules: forest.schedulesByGoal.get(goal.id) ?? []
		}
	);
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
	const forest = await loadForest(user.id);
	// Archived and finished goals are loaded because a parent counts what its
	// children closed before they were parked or landed; they are not listed.
	// Everything that reads this — the dashboard, Today, the universe and the
	// reminders — is about what is still flying.
	return forest.goals
		.filter((goal) => isFlying(goal, now))
		.map((goal) => snapshotFromForest(goal, forest, user, now));
}

/** A finished goal as the hangar and its own page show it. */
export interface FinishedGoal {
	/** Read back from its last instant, with the usual twelve orbits of history. */
	snapshot: GoalSnapshot;
	record: FinalRecord;
}

/** What the hangar holds: goals that have landed, and goals that are parked. */
export interface Hangar {
	/** Most recently finished first. */
	finished: FinishedGoal[];
	/** Most recently archived first, each frozen at the moment it was archived. */
	archived: GoalSnapshot[];
}

/**
 * Every goal that is not flying, with its final numbers.
 *
 * Each one is snapshotted from `recordInstant()`: an archived goal at the
 * instant it was archived, so the listing shows the orbit it stopped on rather
 * than a row of empty periods it was never awake for, and a finished one at its
 * last instant, so its record is the periods it flew. A goal whose end passed
 * while it was archived is finished — see `goalStatus()`.
 */
export async function listHangar(user: SessionUser, now = new Date()): Promise<Hangar> {
	const forest = await loadForest(user.id);
	const snapshot = (goal: Goal) => snapshotFromForest(goal, forest, user, recordInstant(goal, now));
	const at = (date: Date | null) => date?.getTime() ?? 0;

	return {
		finished: forest.goals
			.filter((goal) => goalStatus(goal, now) === 'finished')
			.sort((a, b) => at(b.endsAt) - at(a.endsAt))
			.map((goal) => finishedFromForest(goal, forest, user, now)),
		archived: forest.goals
			.filter((goal) => goalStatus(goal, now) === 'archived')
			.sort((a, b) => at(b.archivedAt) - at(a.archivedAt))
			.map(snapshot)
	};
}

/**
 * Bounds how far back a statistic ever looks, whatever a goal's actual age.
 *
 * `listGoalSnapshots()` already notes the shape of this trade-off: fine for
 * years of daily history, wrong once someone has decades of it. 3660 covers
 * ten years of the shortest cadence there is, which is generous for a stats
 * page nobody is paying for beyond that.
 */
const MAX_STATS_HISTORY = 3660;

/**
 * A finished goal's record and its ordinary snapshot.
 *
 * The record wants the whole flight — its best run might be anywhere in it —
 * so the snapshot is computed once at that length, judged, and then cut back
 * to the window every other screen carries rather than shipping years of orbits
 * to draw twelve.
 */
function finishedFromForest(
	goal: Goal,
	forest: Forest,
	user: SessionUser,
	now: Date
): FinishedGoal {
	const anchor = recordInstant(goal, now);
	const flight = Math.min(
		MAX_STATS_HISTORY,
		periodsSinceLaunch(goal.createdAt, anchor, cadenceOf(goal.tier), periodOptions(user))
	);
	const full = snapshotFromForest(goal, forest, user, anchor, flight);
	return {
		snapshot: { ...full, history: full.history.slice(0, 12) },
		record: finalRecord(full)
	};
}

/** What `/stats` needs: active goals' full-lifetime orbits, and active leaf goals' raw entries. */
export interface StatsInputs {
	/** Every active goal, leaf or derived, with orbit history back to launch. */
	snapshots: GoalSnapshot[];
	/**
	 * Active goals with no children — the only ones with entries of their own.
	 * Momentum and the logging rhythm need a continuous, timestamped stream,
	 * which a derived goal does not carry: its number only moves when a child
	 * orbit closes, not while its own period runs.
	 */
	leaves: {
		goal: Goal;
		entries: ProgressEntry[];
		dormantWindows: DormantWindow[];
		restSchedules: RestSchedule[];
	}[];
}

/**
 * Everything `/stats` computes from, loaded once.
 *
 * Best streak and completion rate want a goal's whole lifetime of orbits, not
 * the 12-orbit window every other screen defaults to, so each goal's history
 * is sized to its own age via `periodsSinceLaunch()` rather than a fixed
 * count that would either cut a long-lived goal short or build months of
 * empty orbits for a goal launched last week.
 *
 * Archived goals are left out entirely: the numbers here are about what is
 * still in orbit. Finished goals are in (#67) — their orbits were flown, and
 * each is read back from its last instant with a history exactly as long as
 * its flight, so completion never counts a period after the end. Momentum and
 * the logging rhythm are about the pace now, so `leaves` stays live goals only.
 */
export async function loadStatsInputs(user: SessionUser, now = new Date()): Promise<StatsInputs> {
	const forest = await loadForest(user.id);
	const counted = forest.goals.filter((goal) => goalStatus(goal, now) !== 'archived');

	const snapshots = counted.map((goal) => {
		const anchor = recordInstant(goal, now);
		const historyLength = Math.min(
			MAX_STATS_HISTORY,
			periodsSinceLaunch(goal.createdAt, anchor, cadenceOf(goal.tier), periodOptions(user))
		);
		return snapshotFromForest(goal, forest, user, anchor, historyLength);
	});

	const leaves = counted
		.filter((goal) => isFlying(goal, now))
		.filter((goal) => childrenOf(goal.id, forest.goals).length === 0)
		.map((goal) => ({
			goal,
			entries: forest.entriesByGoal.get(goal.id) ?? [],
			dormantWindows: forest.dormantByGoal.get(goal.id) ?? [],
			restSchedules: forest.schedulesByGoal.get(goal.id) ?? []
		}));

	return { snapshots, leaves };
}

/** What the year in review (#68) computes from — see `$domain/review`. */
export interface ReviewSources {
	/** Every goal, archived ones included, with orbit history back to launch. */
	goals: { goal: Goal; history: Orbit[] }[];
	notes: OrbitNote[];
	/** The earliest launch on the account, or null with no goals at all. */
	firstLaunch: Date | null;
}

/**
 * Everything the year in review reads, loaded once.
 *
 * Unlike `/stats`, archived goals are in: a goal parked in October still flew
 * from January to September, and that belongs to the year. Its dormant
 * windows are already on its orbits as `Orbit.dormant`, which is the only
 * thing the review reads to decide what was possible — rest days (#66) arrive
 * the same way and need nothing from here. Each history is sized to
 * the goal's age, the same way `loadStatsInputs()` sizes it, and stops at its
 * end when it has one.
 */
export async function loadReviewInputs(user: SessionUser, now: Date): Promise<ReviewSources> {
	const forest = await loadForest(user.id);
	const options = periodOptions(user);

	const reviewGoals = forest.goals.map((goal) => {
		// A finished goal's history is read back from its last instant (#67), so
		// it is sized to the periods it flew: nothing after its end counts as
		// possible, and nothing before its launch is reached for either. An
		// archived goal is still read from now — its dormant orbits say so.
		const { anchor } = flightAnchor(goal, now);
		const historyLength = Math.min(
			MAX_STATS_HISTORY,
			periodsSinceLaunch(goal.createdAt, anchor, cadenceOf(goal.tier), options)
		);
		return { goal, history: snapshotFromForest(goal, forest, user, now, historyLength).history };
	});

	const firstLaunch = forest.goals.reduce<Date | null>(
		(earliest, goal) => (!earliest || goal.createdAt < earliest ? goal.createdAt : earliest),
		null
	);

	return { goals: reviewGoals, notes: await notesForUser(user.id), firstLaunch };
}

/**
 * When the account launched its first goal, archived and finished ones
 * included, or null with none at all — which years the review (#68) has.
 */
export async function firstLaunch(userId: string): Promise<Date | null> {
	const [row] = await db
		.select({ createdAt: goals.createdAt })
		.from(goals)
		.where(eq(goals.userId, userId))
		.orderBy(asc(goals.createdAt))
		.limit(1);
	return row?.createdAt ?? null;
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
): Promise<{
	snapshot: GoalSnapshot;
	recentEntries: ProgressEntry[];
	/** Set once the goal has finished: what it has to show for its flight. */
	record: FinalRecord | null;
} | null> {
	const goal = await getGoal(user.id, goalId);
	if (!goal) return null;

	const forest = await loadForest(user.id);
	const recentEntries = [...(forest.entriesByGoal.get(goal.id) ?? [])]
		.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
		.slice(0, 50);

	if (isFinished(goal, now)) {
		return { ...finishedFromForest(goal, forest, user, now), recentEntries };
	}
	return {
		// An archived goal is frozen at the moment it was archived.
		snapshot: snapshotFromForest(goal, forest, user, recordInstant(goal, now)),
		recentEntries,
		record: null
	};
}

export interface GoalHistoryPage {
	goal: Goal;
	/** Whether this goal has children — see `metricFor`, which is what `metric` already reads through. */
	derived: boolean;
	metric: MetricDefinition;
	/** This page's cells, oldest first — a calendar reads left to right, forward in time. */
	cells: HistoryCell[];
	/** Clamped to what the goal's age actually has. */
	page: number;
	hasOlder: boolean;
	hasNewer: boolean;
}

/**
 * One page of a goal's whole history — issue #15's heatmap and orbit list,
 * paged back through its whole life rather than the twelve-orbit window
 * `getGoalDetail()` shows.
 *
 * `snapshotFromForest()` already builds an arbitrary-length orbit list from
 * the same loaded forest `loadStatsInputs()` reads, so a page is a slice of
 * a long enough one rather than a second pass over the entries with its own
 * dormancy rules to keep in sync. Page 0 is the most recent
 * `HISTORY_PAGE_LENGTH` periods (including the one in flight), page 1 the
 * `HISTORY_PAGE_LENGTH` before that, and so on back to the goal's launch.
 */
export async function getGoalHistoryPage(
	user: SessionUser,
	goalId: string,
	now: Date,
	page = 0
): Promise<GoalHistoryPage | null> {
	const goal = await getGoal(user.id, goalId);
	if (!goal) return null;

	const forest = await loadForest(user.id);
	const options = periodOptions(user);
	const cadence = cadenceOf(goal.tier);
	// Frozen or finished goals are read from the same instant as the detail page.
	const anchor = recordInstant(goal, now);
	const pageLength = HISTORY_PAGE_LENGTH[cadence];

	const lifetimePeriods = Math.min(
		MAX_STATS_HISTORY,
		periodsSinceLaunch(goal.createdAt, anchor, cadence, options)
	);
	const maxPage = Math.max(0, Math.ceil(lifetimePeriods / pageLength) - 1);
	const safePage = Math.min(Math.max(0, page), maxPage);
	const offset = safePage * pageLength;
	const windowLength = Math.min(pageLength, lifetimePeriods - offset);

	const snapshot = snapshotFromForest(goal, forest, user, anchor, offset + windowLength);
	// Newest first out of the snapshot; oldest first for a calendar to draw left to right.
	const window = [...snapshot.history.slice(offset, offset + windowLength)].reverse();

	const children = childInputs(goal.id, forest);
	const detailsByPeriod =
		children.length > 0
			? detailsFromClosures(
					children.map((child) => ({
						title: child.goal.title,
						periods: closedPeriods(child, options)
					})),
					cadence,
					options
				)
			: detailsFromEntries(forest.entriesByGoal.get(goal.id) ?? [], cadence, options);
	const notesByPeriod = await notesForGoal(user.id, goalId);

	return {
		goal,
		derived: children.length > 0,
		metric: children.length > 0 ? ORBIT_METRIC : goal.metric,
		cells: historyCells(window, detailsByPeriod, notesByPeriod),
		page: safePage,
		hasOlder: offset + windowLength < lifetimePeriods,
		hasNewer: safePage > 0
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

/**
 * A goal's rest-day schedule spans, oldest first, or null when the goal is not
 * this user's. Read under the user's id like everything else here.
 */
export async function getGoalSchedule(
	userId: string,
	goalId: string
): Promise<RestSchedule[] | null> {
	const goal = await getGoal(userId, goalId);
	if (!goal) return null;
	return (await restSchedulesFor([goalId])).get(goalId) ?? [];
}

/**
 * How many orbits this goal's children can close in its current period without
 * flying a rest day, or null when none of them rests — see `restDayCapacity`.
 * The parent's form warns when its target is above it.
 */
export async function childRestDayCapacity(
	user: SessionUser,
	goalId: string,
	now: Date
): Promise<number | null> {
	const goal = await getGoal(user.id, goalId);
	if (!goal) return null;
	const forest = await loadForest(user.id);
	const children = childInputs(goal.id, forest).filter((child) => child.goal.archivedAt === null);
	if (children.length === 0) return null;
	return restDayCapacity(goal, children, now, periodOptions(user));
}

/**
 * Write a schedule change for a goal already known to be this user's.
 *
 * `scheduleChange()` decides the span: from tomorrow for an edit, from today
 * for a launch, nothing when the schedule already says this. Pending spans from
 * that instant on are replaced, so two edits in a day leave one.
 */
async function saveSchedule(
	goalId: string,
	restDays: number,
	now: Date,
	options: PeriodOptions & { launching: boolean }
): Promise<void> {
	const existing = options.launching ? [] : ((await restSchedulesFor([goalId])).get(goalId) ?? []);
	const change = scheduleChange(existing, restDays, now, options);

	db.transaction((tx) => {
		tx.delete(goalSchedules)
			.where(and(eq(goalSchedules.goalId, goalId), gte(goalSchedules.from, change.from)))
			.run();
		if (change.insert) {
			tx.insert(goalSchedules)
				.values({ id: newId(), goalId, ...change.insert })
				.run();
		}
	});
}

/**
 * What a write refused, when it refused one.
 *
 * `parent` carries the reason the edge was rejected — see
 * `PARENT_PROBLEM_MESSAGE` — and `tier` means the goal's own tier no longer
 * clears the children already feeding it.
 */
export type GoalWriteProblem =
	| { kind: 'parent'; problem: ParentProblem }
	| { kind: 'tier' }
	| { kind: 'end'; problem: EndProblem };

export type GoalWriteResult =
	| { ok: true; goal: Goal }
	| { ok: false; missing: true }
	| { ok: false; missing?: false; problem: GoalWriteProblem };

/**
 * Every nesting rule, checked here rather than in the route.
 *
 * Same reason `logEntry()` re-reads the goal under the user's id: the caller's
 * own goals are the only ones a parent may be picked from, so the check needs
 * the user, and every caller should get the guarantee without asking for it.
 * `parentProblem()` reports a goal that is not in that set as `unknown`, which
 * is how "somebody else's goal" is refused without saying whether it exists.
 */
async function nestingProblem(
	userId: string,
	goal: { id?: string | null; tier: Tier; endsAt: Date | null },
	parentId: string | null,
	options: PeriodOptions
): Promise<GoalWriteProblem | null> {
	const owned = await listGoals(userId, true);

	const problem = parentProblem(goal, parentId, owned, options);
	if (problem) return { kind: 'parent', problem };

	// Moving down the ladder can break the rule from the other side.
	if (goal.id && tierProblem(goal.id, goal.tier, owned)) return { kind: 'tier' };

	return null;
}

/**
 * Create a goal. `options` is the pilot's zone and week start, which is what an
 * end is read in: the form names a last day, and the instant stored is the end
 * of the period holding that day *there*.
 */
export async function createGoal(
	userId: string,
	input: GoalInput,
	options: PeriodOptions
): Promise<GoalWriteResult> {
	const now = new Date();
	const end = resolveEnd(input.ends, input.endsOn, {
		tier: input.tier,
		now,
		options,
		current: null
	});
	if (!end.ok) return { ok: false, problem: { kind: 'end', problem: end.problem } };

	const problem = await nestingProblem(
		userId,
		{ tier: input.tier, endsAt: end.endsAt },
		input.parentId,
		options
	);
	if (problem) return { ok: false, problem };

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
		createdAt: now,
		archivedAt: null,
		endsAt: end.endsAt,
		parentId: input.parentId
	};
	await db.insert(goals).values(row);
	if (input.restDays) {
		await saveSchedule(row.id, input.restDays, row.createdAt, { ...options, launching: true });
	}
	return { ok: true, goal: toGoal(row) };
}

/**
 * Save an edit, including the goal's end.
 *
 * Moving the end later can bring a finished goal back (#67). Nothing is written
 * for the periods it spent landed: they are ordinary periods with nothing in
 * them, so they read as missed rather than dormant. A goal that finished while
 * archived is restored on the way back, its archive window closed at the old
 * end so the gap after it is missed too.
 *
 * Giving a parent an end decides its children's in the same transaction: each
 * child that would outlive it either ends with it (`endUnder()`) or is detached,
 * as `input.childEnding` says, so no live goal is left hanging off a finished
 * one.
 */
export async function updateGoal(
	userId: string,
	goalId: string,
	input: GoalInput,
	options: PeriodOptions
): Promise<GoalWriteResult> {
	const existing = await getGoal(userId, goalId);
	if (!existing) return { ok: false, missing: true };

	const now = new Date();
	const end = resolveEnd(input.ends, input.endsOn, {
		tier: input.tier,
		now,
		options,
		current: existing.endsAt
	});
	if (!end.ok) return { ok: false, problem: { kind: 'end', problem: end.problem } };
	const endsAt = end.endsAt;

	// The tier being saved, not the one on the row: an edit can move a goal up
	// or down the ladder in the same submit that picks its parent.
	const problem = await nestingProblem(
		userId,
		{ id: goalId, tier: input.tier, endsAt },
		input.parentId,
		options
	);
	if (problem) return { ok: false, problem };

	const flyingAgain = isFinished(existing, now) && !isFinished({ endsAt }, now);
	const restoring = flyingAgain && existing.archivedAt !== null;
	const archivedAt = restoring ? null : existing.archivedAt;
	const children = endsAt
		? (await listGoals(userId, true)).filter(
				(child) => child.parentId === goalId && outlives(child, { endsAt }, options)
			)
		: [];

	const changed = db.transaction((tx) => {
		const result = tx
			.update(goals)
			.set({
				title: input.title,
				description: input.description,
				tier: input.tier,
				metricKind: input.metricKind,
				metricUnit: input.metricUnit,
				target: input.target,
				color: input.color,
				parentId: input.parentId,
				endsAt,
				archivedAt
			})
			.where(and(eq(goals.id, goalId), eq(goals.userId, userId)))
			.run();
		if (result.changes === 0) return false;

		if (restoring && existing.endsAt) {
			tx.update(goalArchiveWindows)
				.set({ restoredAt: existing.endsAt })
				.where(and(eq(goalArchiveWindows.goalId, goalId), isNull(goalArchiveWindows.restoredAt)))
				.run();
		}

		for (const child of children) {
			tx.update(goals)
				.set(
					input.childEnding === 'end' && endsAt
						? { endsAt: endUnder(endsAt, child.tier, options) }
						: { parentId: null }
				)
				.where(and(eq(goals.id, child.id), eq(goals.userId, userId)))
				.run();
		}
		return true;
	});
	if (!changed) return { ok: false, missing: true };
	if (input.restDays !== null) {
		await saveSchedule(goalId, input.restDays, now, { ...options, launching: false });
	}

	return {
		ok: true,
		goal: {
			...existing,
			title: input.title,
			description: input.description,
			tier: input.tier,
			metric: { kind: input.metricKind, unit: input.metricUnit },
			target: input.target,
			color: input.color,
			parentId: input.parentId,
			endsAt,
			archivedAt
		}
	};
}

/**
 * Archive or restore, recording the dormant span either way.
 *
 * The update only matches a goal already in the opposite state, so a double
 * submit cannot open two windows, and the window row travels with it in the
 * same transaction — a half-written pair would leave orbits dormant forever.
 *
 * A finished goal is neither archived nor restored: it has landed, and the way
 * back for it is a later end, in `updateGoal()`.
 */
export async function setGoalArchived(
	userId: string,
	goalId: string,
	archived: boolean
): Promise<boolean> {
	const now = new Date();
	const goal = await getGoal(userId, goalId);
	if (!goal || isFinished(goal, now)) return false;
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

/** Why a log was refused. */
export type LogRefusal = 'missing' | 'archived' | 'finished' | 'derived';

export type LogResult = { ok: true; entry: ProgressEntry } | { ok: false; reason: LogRefusal };

export const LOG_REFUSAL_MESSAGE: Record<LogRefusal, string> = {
	missing: 'That goal is no longer in orbit.',
	archived: 'This goal is archived. Restore it before logging against it.',
	finished: 'This goal has finished. Give it a later end to bring it back.',
	derived:
		'This goal counts the orbits its children close, so nothing is logged against it directly.'
};

/** Whether anything feeds this goal, which is what makes it derived. */
async function hasChildren(userId: string, goalId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: goals.id })
		.from(goals)
		.where(and(eq(goals.userId, userId), eq(goals.parentId, goalId)))
		.limit(1);
	return row !== undefined;
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
): Promise<LogResult> {
	// An archived goal is dormant: restoring it is the way back to logging.
	const goal = await getGoal(userId, goalId);
	if (!goal) return { ok: false, reason: 'missing' };
	// Finished first: a goal whose end passed while it was archived has landed,
	// and restoring it would not make it loggable.
	if (isFinished(goal, new Date())) return { ok: false, reason: 'finished' };
	if (goal.archivedAt) return { ok: false, reason: 'archived' };
	// A goal with children counts their closed orbits, so there is nothing an
	// entry here could mean. Refused at write time rather than ignored at read
	// time, so a queued entry against a goal that has since become a parent gets
	// a reason it can stop retrying on.
	if (await hasChildren(userId, goalId)) return { ok: false, reason: 'derived' };

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
		return { ok: true, entry: toEntry(row) };
	}

	const result = await db
		.insert(entries)
		.values(row)
		.onConflictDoNothing({ target: [entries.goalId, entries.clientId] });
	if (result.changes > 0) return { ok: true, entry: toEntry(row) };

	// The entry landed on an earlier attempt whose answer never arrived. Hand
	// back what was written then, so the caller sees a success rather than
	// retrying forever against a constraint it cannot satisfy.
	const [existing] = await db
		.select()
		.from(entries)
		.where(and(eq(entries.goalId, goalId), eq(entries.clientId, clientId)))
		.limit(1);
	return existing ? { ok: true, entry: toEntry(existing) } : { ok: false, reason: 'missing' };
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
	if (!goal || goal.archivedAt || isFinished(goal, new Date())) return null;
	if (await hasChildren(userId, goalId)) return null;

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
