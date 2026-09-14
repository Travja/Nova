import { clientEntryIdSchema, entrySchemaFor, occurredAtBounds } from '$domain/validation';
import type { SessionUser } from '$lib/server/auth/session';
import { getGoal, logEntry } from '$lib/server/goals';
import type { Goal } from '$domain/types';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

/**
 * Where the offline queue empties itself.
 *
 * The form actions are the API everywhere else in Nova, and they stay the API
 * for a live log. This exists because a queued entry is a different thing: it
 * carries the instant it was made rather than being stamped on arrival, it
 * carries the id that makes a retry safe, and several of them land at once
 * after a reconnection. A form action answers with a page's worth of data and
 * replays awkwardly from a service worker; this answers with one line per
 * entry, which is what the queue needs to decide what to drop.
 *
 * Every entry still goes through `logEntry()`, so ownership is checked in the
 * same place it is for a live log — arriving late buys nothing.
 */

/** Enough for a long weekend offline, and a bound on what one request can cost. */
const MAX_BATCH = 100;

const flushSchema = z.object({
	entries: z
		.array(
			z.object({
				goalId: z.string().trim().min(1).max(64),
				clientId: clientEntryIdSchema,
				amount: z.unknown(),
				note: z.unknown().optional(),
				occurredAt: z.unknown()
			})
		)
		.min(1)
		.max(MAX_BATCH)
});

/**
 * What happened to one queued entry.
 *
 * `logged` covers the entry that was written and the one that turns out to
 * have been written already — the queue does the same thing with both, which
 * is to stop carrying it. `rejected` says the entry will never be accepted, so
 * retrying it is pointless; anything else (a network failure, a 500) leaves
 * the entry queued and is not answered from here at all.
 */
export interface FlushResult {
	clientId: string;
	status: 'logged' | 'rejected';
	/** Why it was refused, in words a person can read. Only on `rejected`. */
	reason?: string;
}

function periodOptions(user: SessionUser) {
	return { timeZone: user.timeZone, weekStartsOn: user.weekStartsOn };
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// A queue that flushes into a signed-out session must not be emptied: the
	// entries are still good, they just need somebody to sign in again.
	if (!locals.user) return json({ error: 'Sign in to sync what you logged.' }, { status: 401 });

	const body = await request.json().catch(() => null);
	const parsed = flushSchema.safeParse(body);
	if (!parsed.success) return json({ error: 'Nova could not read that queue.' }, { status: 400 });

	const now = new Date();
	// One read per goal however many entries a flush carries for it.
	const goals = new Map<string, Goal | null>();
	const results: FlushResult[] = [];

	for (const queued of parsed.data.entries) {
		if (!goals.has(queued.goalId)) {
			goals.set(queued.goalId, await getGoal(locals.user.id, queued.goalId));
		}
		const goal = goals.get(queued.goalId) ?? null;
		if (!goal) {
			results.push({
				clientId: queued.clientId,
				status: 'rejected',
				reason: 'That goal is no longer in orbit.'
			});
			continue;
		}

		/*
		 * The same bounds a backdated entry is held to, and for the same reason:
		 * an entry cannot land in an orbit that ran before the goal existed. The
		 * floor is the goal's launch rather than anything relative to now, so
		 * Monday's entry flushed on Wednesday is never too old — and the ceiling
		 * carries `CLOCK_SKEW_MS`, so a phone running a few minutes fast is not
		 * told its own present is the future.
		 */
		const entry = entrySchemaFor(occurredAtBounds(goal, periodOptions(locals.user), now)).safeParse(
			queued
		);
		if (!entry.success) {
			results.push({
				clientId: queued.clientId,
				status: 'rejected',
				reason: entry.error.issues[0]?.message ?? 'Nova could not read that entry.'
			});
			continue;
		}
		if (!entry.data.occurredAt) {
			results.push({
				clientId: queued.clientId,
				status: 'rejected',
				reason: 'That entry does not say when it happened.'
			});
			continue;
		}

		const logged = await logEntry(locals.user.id, goal.id, {
			amount: entry.data.amount,
			note: entry.data.note,
			// The instant the entry was made, never the instant it arrived: an
			// entry logged on Monday and flushed on Wednesday belongs to Monday.
			occurredAt: entry.data.occurredAt,
			clientId: queued.clientId
		});

		results.push(
			logged
				? { clientId: queued.clientId, status: 'logged' }
				: {
						clientId: queued.clientId,
						status: 'rejected',
						reason: 'That goal is archived. Restore it before logging against it.'
					}
		);
	}

	return json({ results });
};
