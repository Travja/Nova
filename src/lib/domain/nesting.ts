import { periodFor, recentPeriods, type Period, type PeriodOptions } from './period';
import {
	buildOrbit,
	isDormant,
	snapshotGoal,
	streakFrom,
	type ChildStanding,
	type DormantWindow,
	type GoalSnapshot,
	type SnapshotOptions
} from './progress';
import { cadenceOf, isLongerCadence, type Tier } from './tiers';
import type { Goal, MetricDefinition, ProgressEntry } from './types';

/**
 * Nested orbits: how a goal's closed orbits feed the goal above it.
 *
 * ## A parent counts closed child orbits
 *
 * Settled in `docs/issues/12-nested-orbits.md`. The alternative was summing the
 * child's raw amounts, and the difference is what each one measures: summing
 * measures volume, counting closed orbits measures consistency. Nova's premise
 * is consistency, so counting is the one that earns the feature — the parent
 * expresses the thing the child cannot, which is how many weeks you actually
 * hit it this month.
 *
 * Under-counting runs in both directions and both are deliberate:
 *
 * - A child period that falls short contributes **nothing**. Two of three
 *   workouts in a week is zero toward the month.
 * - A child period that overshoots contributes **exactly one**. Nine workouts in
 *   a week where the target is three is one closed orbit, not three.
 *
 * A parent therefore cannot be gamed by cramming and cannot be rescued by a
 * heroic final week. Do not "fix" either direction without revisiting that
 * section of the spec.
 *
 * ## Everything here is pure
 *
 * Like `snapshotGoal()` beside it, and for the same reason: the service in
 * `src/lib/server/goals.ts` loads the shape — the direct children, their
 * entries, their dormant windows — and this does the maths over plain data.
 * Nothing here reads a database or knows what a request is.
 */

type EntryLike = Pick<ProgressEntry, 'amount' | 'occurredAt'>;

/**
 * A goal in a tree, with everything the maths needs already loaded.
 *
 * Recursive because a child can itself be a parent. A goal counts its direct
 * children only — a Star System counts Planet orbits and never reaches down for
 * the Satellite orbits under them — but the Planet orbits it counts are
 * themselves derived, so the whole branch has to be resolved to know how many
 * of them closed.
 */
export interface ChildInput {
	goal: Goal;
	/** Entries logged against this goal. Ignored entirely once it has children. */
	entries: readonly EntryLike[];
	/** Spans this goal spent archived. A period inside one never closed. */
	dormantWindows?: readonly DormantWindow[];
	/** This goal's own direct children, when it has any. */
	children?: readonly ChildInput[];
}

/**
 * What a derived goal is measured in.
 *
 * A parent's target is a count of closed child orbits — "close 4 weekly orbits
 * this month" — so its unit is the orbit itself, whatever metric its row
 * carries from before it had children. Read it through `metricFor(snapshot)`
 * rather than reaching for `goal.metric`, which is the metric the goal would go
 * back to using the moment its last child left.
 */
export const ORBIT_METRIC: MetricDefinition = { kind: 'count', unit: 'orbits' };

/** The metric a snapshot's amounts are actually in — orbits once it is derived. */
export function metricFor(snapshot: GoalSnapshot): MetricDefinition {
	return snapshot.derived ? ORBIT_METRIC : snapshot.goal.metric;
}

/**
 * The parent period a closed child orbit counts towards: the one containing the
 * child period's end. A week that straddles a month boundary counts toward the
 * month it finished in.
 *
 * The instant that decides it is the child period's **last** one, not
 * `period.end`. `end` is exclusive — a week's `end` is the instant the next week
 * starts — so a week that finishes on the last day of October has an `end` of
 * 1 November, and reading it directly would file that week under November. The
 * mistake shows up nowhere else: no test fails, nothing throws, the parent's
 * orbit is simply and quietly one out.
 */
export function parentPeriodFor(
	childPeriod: Period,
	parentCadence: Period['cadence'],
	options: PeriodOptions
): Period {
	return periodFor(new Date(childPeriod.end.getTime() - 1), parentCadence, options);
}

/** What a goal has to show for each period it has anything in, in its own terms. */
interface PeriodTotal {
	period: Period;
	/** Logged amount for a leaf; closed child orbits for a derived goal. */
	logged: number;
}

/**
 * Every period this goal has something in, whatever it counts.
 *
 * The two branches are the same shape and that is the point: a derived goal
 * buckets its children's closed orbits exactly where a leaf buckets its
 * entries, so everything downstream — closing, streaks, dormancy, history —
 * reads one kind of number.
 *
 * Only periods with something in them appear. That is both the fast answer and
 * the complete one: a period with nothing in it sums to zero, a target is
 * positive, so it can never have closed.
 */
function periodTotals(node: ChildInput, options: PeriodOptions): Map<string, PeriodTotal> {
	const cadence = cadenceOf(node.goal.tier);
	const totals = new Map<string, PeriodTotal>();

	const add = (period: Period, amount: number) => {
		const bucket = totals.get(period.key);
		if (bucket) bucket.logged += amount;
		else totals.set(period.key, { period, logged: amount });
	};

	if (node.children && node.children.length > 0) {
		for (const child of node.children) {
			// One per closed child period however far past its target it went.
			for (const closed of closedPeriods(child, options)) {
				add(parentPeriodFor(closed, cadence, options), 1);
			}
		}
	} else {
		for (const entry of node.entries) {
			add(periodFor(entry.occurredAt, cadence, options), entry.amount);
		}
	}

	return totals;
}

/**
 * The periods in which this goal closed an orbit.
 *
 * A period the goal spent archived is dropped here rather than counted and
 * subtracted later — `Orbit.dormant` from the archive work is the one notion of
 * asleep, and a dormant period contributes nothing to a parent without
 * breaking anything.
 */
export function closedPeriods(node: ChildInput, options: PeriodOptions): Period[] {
	if (node.goal.target <= 0) return [];
	const dormantWindows = node.dormantWindows ?? [];

	return [...periodTotals(node, options).values()]
		.filter((bucket) => bucket.logged >= node.goal.target)
		.filter((bucket) => !isDormant(bucket.period, dormantWindows))
		.map((bucket) => bucket.period);
}

/**
 * How many of this child's orbits closed in each of the parent's periods, keyed
 * by the parent period's key. The map counts periods, never amounts.
 */
export function closuresByParentPeriod(
	child: ChildInput,
	parentCadence: Period['cadence'],
	options: PeriodOptions
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const period of closedPeriods(child, options)) {
		const { key } = parentPeriodFor(period, parentCadence, options);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

/**
 * A goal's orbits, counted from the orbits its direct children closed.
 *
 * Anything logged directly against a derived goal is ignored here on purpose —
 * it is refused at write time too, by `logEntry()` — because mixing manual
 * entries with derived closures makes "what closed this orbit" unanswerable and
 * leaves the parent's unit ambiguous.
 */
export function snapshotDerivedGoal(
	parent: Goal,
	children: readonly ChildInput[],
	options: SnapshotOptions
): GoalSnapshot {
	const { historyLength = 12, now = new Date(), dormantWindows = [], ...periodOptions } = options;
	const cadence = cadenceOf(parent.tier);

	/** Closures per parent period, and the same again per child for the dial. */
	const total = new Map<string, number>();
	const perChild = new Map<string, Map<string, number>>();

	for (const child of children) {
		const counts = closuresByParentPeriod(child, cadence, periodOptions);
		perChild.set(child.goal.id, counts);
		for (const [key, count] of counts) total.set(key, (total.get(key) ?? 0) + count);
	}

	const history = recentPeriods(now, cadence, historyLength, periodOptions).map((period) =>
		buildOrbit(period, total.get(period.key) ?? 0, parent.target, isDormant(period, dormantWindows))
	);

	let totalOrbits = 0;
	let lifetimeLogged = 0;
	for (const count of total.values()) {
		lifetimeLogged += count;
		if (parent.target > 0 && count >= parent.target) totalOrbits += 1;
	}

	const currentKey = history[0].period.key;

	return {
		goal: parent,
		current: history[0],
		history,
		streak: streakFrom(history),
		totalOrbits,
		lifetimeLogged,
		derived: {
			children: children.map((child) =>
				standingFor(child, perChild.get(child.goal.id)?.get(currentKey) ?? 0, now, periodOptions)
			)
		}
	};
}

/** One child as the parent's dial draws it: its own orbit, and what it has fed up. */
function standingFor(
	child: ChildInput,
	closed: number,
	now: Date,
	options: PeriodOptions
): ChildStanding {
	const period = periodFor(now, cadenceOf(child.goal.tier), options);
	const logged = periodTotals(child, options).get(period.key)?.logged ?? 0;

	return {
		goalId: child.goal.id,
		title: child.goal.title,
		tier: child.goal.tier,
		color: child.goal.color,
		current: buildOrbit(
			period,
			logged,
			child.goal.target,
			isDormant(period, child.dormantWindows ?? [])
		),
		closed
	};
}

/**
 * A snapshot for a goal that may or may not have children — the one entry point
 * a caller needs.
 *
 * Having children is what makes a goal derived, so the choice is made here
 * rather than at each call site, and `snapshotGoal()` stays exactly what it was
 * for a leaf.
 */
export function snapshotWithChildren(
	goal: Goal,
	entries: readonly EntryLike[],
	children: readonly ChildInput[],
	options: SnapshotOptions
): GoalSnapshot {
	return children.length > 0
		? snapshotDerivedGoal(goal, children, options)
		: snapshotGoal(goal, entries, options);
}

/** Enough of a goal to judge whether it can be somebody's parent. */
export type ParentCandidate = Pick<Goal, 'id' | 'title' | 'tier' | 'parentId'> & {
	archivedAt?: Date | null;
};

/** Why a parent cannot be used. */
export type ParentProblem = 'unknown' | 'self' | 'cadence' | 'cycle';

export const PARENT_PROBLEM_MESSAGE: Record<ParentProblem, string> = {
	unknown: 'That goal is not one of yours.',
	self: 'A goal cannot orbit itself.',
	cadence:
		'A goal can only feed one with a longer cadence — a weekly Planet into a monthly Star System, never the other way round.',
	cycle: 'That would close a loop: the goal you picked already feeds this one.'
};

/**
 * Whether `parentId` is a parent this goal may declare, given the goals the
 * user owns. Null when it may.
 *
 * Every rejection happens here, at write time. A cycle found at read time is a
 * stack overflow in the middle of drawing a dashboard, and a parent belonging to
 * somebody else is not a thing to discover while rendering: pass only the
 * caller's own goals and `unknown` covers both a goal that does not exist and
 * one that is not theirs, without the difference leaking.
 */
export function parentProblem(
	child: { id?: string | null; tier: Tier },
	parentId: string | null | undefined,
	goals: readonly ParentCandidate[]
): ParentProblem | null {
	if (!parentId) return null;
	if (child.id && parentId === child.id) return 'self';

	const byId = new Map(goals.map((goal) => [goal.id, goal]));
	const parent = byId.get(parentId);
	if (!parent) return 'unknown';
	if (!isLongerCadence(cadenceOf(parent.tier), cadenceOf(child.tier))) return 'cadence';

	// Walk up from the proposed parent. Reaching this goal means the edge would
	// close a loop; `seen` guards the walk itself against data that already has
	// one, which is the thing this function exists to make impossible.
	const seen = new Set<string>([parent.id]);
	let ancestor = parent.parentId ? byId.get(parent.parentId) : undefined;
	while (ancestor) {
		if (child.id && ancestor.id === child.id) return 'cycle';
		if (seen.has(ancestor.id)) return 'cycle';
		seen.add(ancestor.id);
		ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
	}

	return null;
}

/**
 * Whether this goal may sit in `tier`, given the children already feeding it.
 * Null when it may.
 *
 * The other half of the cadence rule. Declaring a parent is checked when the
 * child declares it, but a goal can also break the rule from above by moving
 * down the ladder — a monthly Star System with weekly children demoted to a
 * daily Satellite leaves every one of those edges pointing the wrong way. That
 * has to be refused at the same place and for the same reason: a tree that is
 * only valid at read time is a tree nothing can be computed from.
 */
export function tierProblem(
	goalId: string,
	tier: Tier,
	goals: readonly ParentCandidate[]
): 'children' | null {
	const children = goals.filter((goal) => goal.parentId === goalId);
	return children.every((child) => isLongerCadence(cadenceOf(tier), cadenceOf(child.tier)))
		? null
		: 'children';
}

export const TIER_PROBLEM_MESSAGE =
	'Another goal already feeds this one, and a goal has to keep a longer cadence than everything feeding it. Move the children first.';

/**
 * The goals this one could be given as a parent, in the order they were handed
 * over. An archived goal is left out — parking a goal is not the moment to
 * start feeding it — though a goal already parked keeps whatever parent it has.
 */
export function eligibleParents(
	child: { id?: string | null; tier: Tier },
	goals: readonly ParentCandidate[]
): ParentCandidate[] {
	return goals.filter((goal) => !goal.archivedAt && parentProblem(child, goal.id, goals) === null);
}

/** The direct children of `goalId` among goals already loaded. */
export function childrenOf<T extends { parentId: string | null }>(
	goalId: string,
	goals: readonly T[]
): T[] {
	return goals.filter((goal) => goal.parentId === goalId);
}
