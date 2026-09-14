import { parentPeriodFor } from './nesting';
import type { PeriodOptions } from './period';
import { bucketByPeriod, buildOrbit, streakFrom, type GoalSnapshot, type Orbit } from './progress';
import { cadenceOf, cadenceRank } from './tiers';

/**
 * What an entry logged offline looks like before the server has seen it, and
 * how it shows on an orbit that has not.
 *
 * This is the payoff for keeping `src/lib/domain/` free of server imports: the
 * browser answers "what does the dial read now?" with the same `buildOrbit`,
 * `bucketByPeriod` and `streakFrom` the dashboard was drawn with, rather than
 * a second implementation of the maths that would drift within a month. The
 * IndexedDB store, the retries and the fetch all live in `$lib/offline`, which
 * is allowed to know about browsers; nothing here is.
 */

/** One entry waiting to reach the server. */
export interface QueuedEntry {
	/** The client id the entry was born with, and the key the insert conflicts on. */
	id: string;
	goalId: string;
	/** Negative is legitimate — it corrects an over-log — and travels unchanged. */
	amount: number;
	note: string | null;
	/** When the work happened. Never restamped, however late the flush is. */
	occurredAt: Date;
	/** When it was queued, which is what the queue is drained in the order of. */
	createdAt: Date;
}

/** The entries in this queue that belong to one goal. */
export function queuedFor(queued: readonly QueuedEntry[], goalId: string): readonly QueuedEntry[] {
	return queued.filter((entry) => entry.goalId === goalId);
}

/**
 * A snapshot with the queue's own entries folded in.
 *
 * Each queued entry is bucketed into the orbit its `occurredAt` falls in, not
 * the one in flight — an entry made on Monday and still waiting on Wednesday
 * moves Monday's orbit, exactly as it will once it reaches the server. An
 * entry whose period is off the end of the history the server sent still
 * counts towards the lifetime total; there is no orbit on screen for it to
 * move.
 *
 * `totalOrbits` is adjusted only for orbits within that history, which is the
 * one number here that is an estimate rather than a recomputation — the server
 * counts every orbit ever closed, and the browser has only the recent ones.
 * The flush replaces the whole snapshot with the server's within a second of
 * reconnecting, so the estimate is never the last word.
 */
export function overlayQueued(
	snapshot: GoalSnapshot,
	queued: readonly QueuedEntry[],
	options: PeriodOptions
): GoalSnapshot {
	// A derived goal counts its children's closed orbits and has no entries of
	// its own — `logEntry()` refuses them — so anything queued against one is
	// stale, and folding an amount into a count of orbits would be nonsense.
	// What does reach it is what its children closed, which `overlayAll` below
	// carries up because only it can see both ends of the edge.
	if (snapshot.derived) return snapshot;

	const mine = queuedFor(queued, snapshot.goal.id);
	if (mine.length === 0) return snapshot;

	const totals = bucketByPeriod(mine, cadenceOf(snapshot.goal.tier), options);

	let closedMore = 0;
	const history = snapshot.history.map((orbit) => {
		const extra = totals.get(orbit.period.key);
		if (extra === undefined) return orbit;

		const moved = buildOrbit(orbit.period, orbit.logged + extra, orbit.target, orbit.dormant);
		if (moved.complete !== orbit.complete) closedMore += moved.complete ? 1 : -1;
		return moved;
	});

	let queuedTotal = 0;
	for (const entry of mine) queuedTotal += entry.amount;

	return {
		...snapshot,
		current: history[0],
		history,
		streak: streakFrom(history),
		totalOrbits: Math.max(0, snapshot.totalOrbits + closedMore),
		lifetimeLogged: snapshot.lifetimeLogged + queuedTotal
	};
}

/**
 * The same, for a screen's worth of goals, with what the queue closes carried
 * up to the parents counting it.
 *
 * A goal logged offline can close its own orbit, and a closed orbit is exactly
 * what a parent counts — so a Planet that closes its week while the phone has
 * no signal has to move the Star System above it, or the two dials on the same
 * screen disagree about the same fact. The maths is the domain's own:
 * `parentPeriodFor` decides which of the parent's periods the closure lands in,
 * the same function the server counted with.
 *
 * Goals are walked shortest cadence first, so a child is finished before the
 * parent reading it — which is what makes a Satellite feeding a Planet feeding
 * a Star System arrive all the way at the top in one pass.
 */
export function overlayAll(
	snapshots: readonly GoalSnapshot[],
	queued: readonly QueuedEntry[],
	options: PeriodOptions
): GoalSnapshot[] {
	if (queued.length === 0) return snapshots as GoalSnapshot[];

	const overlaid = snapshots.map((snapshot) => overlayQueued(snapshot, queued, options));
	if (!overlaid.some((snapshot) => snapshot.derived)) return overlaid;

	const server = new Map(snapshots.map((snapshot) => [snapshot.goal.id, snapshot]));
	const live = new Map(overlaid.map((snapshot) => [snapshot.goal.id, snapshot]));

	const shortestFirst = [...overlaid].sort(
		(a, b) => cadenceRank(cadenceOf(a.goal.tier)) - cadenceRank(cadenceOf(b.goal.tier))
	);

	for (const snapshot of shortestFirst) {
		const child = live.get(snapshot.goal.id);
		const parent = child?.goal.parentId ? live.get(child.goal.parentId) : undefined;
		if (!child || !parent?.derived) continue;

		const deltas = closureDeltas(
			server.get(child.goal.id)?.history ?? [],
			child.history,
			cadenceOf(parent.goal.tier),
			options
		);
		if (deltas.size > 0) live.set(parent.goal.id, withClosures(parent, child, deltas));
	}

	return overlaid.map((snapshot) => live.get(snapshot.goal.id) ?? snapshot);
}

/**
 * Which of the parent's periods gained or lost a closed child orbit, once the
 * queue is folded in. Orbits are compared position by position because both
 * histories were built from the same `recentPeriods` walk.
 */
function closureDeltas(
	before: readonly Orbit[],
	after: readonly Orbit[],
	parentCadence: ReturnType<typeof cadenceOf>,
	options: PeriodOptions
): Map<string, number> {
	const deltas = new Map<string, number>();

	after.forEach((orbit, index) => {
		const was = before[index];
		if (!was || was.complete === orbit.complete) return;
		// A period the child spent archived never closed and never will.
		if (orbit.dormant || was.dormant) return;

		const { key } = parentPeriodFor(orbit.period, parentCadence, options);
		deltas.set(key, (deltas.get(key) ?? 0) + (orbit.complete ? 1 : -1));
	});

	return deltas;
}

/** A parent's snapshot with one child's newly closed orbits counted into it. */
function withClosures(
	parent: GoalSnapshot,
	child: GoalSnapshot,
	deltas: Map<string, number>
): GoalSnapshot {
	let closedMore = 0;
	const history = parent.history.map((orbit) => {
		const delta = deltas.get(orbit.period.key);
		if (!delta) return orbit;

		const moved = buildOrbit(orbit.period, orbit.logged + delta, orbit.target, orbit.dormant);
		if (moved.complete !== orbit.complete) closedMore += moved.complete ? 1 : -1;
		return moved;
	});

	let queuedTotal = 0;
	for (const delta of deltas.values()) queuedTotal += delta;

	const currentKey = history[0].period.key;
	const children = (parent.derived?.children ?? []).map((standing) =>
		standing.goalId === child.goal.id
			? {
					...standing,
					// The child's own body moves on the parent's dial too.
					current: child.current,
					closed: standing.closed + (deltas.get(currentKey) ?? 0)
				}
			: standing
	);

	return {
		...parent,
		current: history[0],
		history,
		streak: streakFrom(history),
		totalOrbits: Math.max(0, parent.totalOrbits + closedMore),
		lifetimeLogged: parent.lifetimeLogged + queuedTotal,
		derived: { children }
	};
}
