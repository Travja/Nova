import type { PeriodOptions } from './period';
import { bucketByPeriod, buildOrbit, streakFrom, type GoalSnapshot } from './progress';
import { cadenceOf } from './tiers';

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

/** The same, for a screen's worth of goals. */
export function overlayAll(
	snapshots: readonly GoalSnapshot[],
	queued: readonly QueuedEntry[],
	options: PeriodOptions
): GoalSnapshot[] {
	if (queued.length === 0) return snapshots as GoalSnapshot[];
	return snapshots.map((snapshot) => overlayQueued(snapshot, queued, options));
}
