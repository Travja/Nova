import { parseLocalDateTime } from '$domain/period';
import type { QueuedEntry } from '$domain/queue';
import type { SubmitFunction } from '@sveltejs/kit';
import { enqueue, newEntryId } from './queue.svelte';

/**
 * The bridge between a log form and the offline queue.
 *
 * Form actions stay the API for a live log — this does not replace the round
 * trip, it catches the two ways it can fail to happen. Every submission is
 * stamped with a client id first, so even the case that looks like a success
 * and is not — the entry written, the answer lost on the way back — is safe to
 * retry from the queue.
 *
 * Two ways in:
 *
 * - `navigator.onLine` is already false. The submission is cancelled before it
 *   is attempted and goes straight to the queue, which is the difference
 *   between a dial that moves and a browser error page.
 * - The request was attempted and failed. `enhance` reports that as an `error`
 *   result, whose default handling is to render the nearest error page over the
 *   top of whatever the user was doing. Queueing it instead is the whole point.
 */

export interface LogQueueOptions {
	/** The goal being logged against. Read here rather than from the form,
	 *  because the goal page's action takes it from the route instead. */
	goalId: string;
	/** The user's zone, needed only where the form carries a `When` field. */
	timeZone?: string;
	/** Told when a submission starts and when it settles, for disabling controls. */
	onbusy?: (busy: boolean) => void;
	/** Called when the entry went to the queue rather than to the server. */
	onqueued?: (entry: QueuedEntry) => void;
	/** Handles a reply that did arrive. Defaults to SvelteKit's own handling. */
	onresult?: Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
}

/**
 * What the form is asking to log, as far as the browser can tell.
 *
 * Returns null for anything it cannot read with confidence — an amount that is
 * not a number, a `When` it cannot parse. Those are the server's to reject
 * with a message; guessing at them here would queue an entry that can only
 * ever be refused.
 */
function draftFrom(id: string, formData: FormData, options: LogQueueOptions): QueuedEntry | null {
	const amount = Number(formData.get('amount'));
	if (!Number.isFinite(amount) || amount === 0) return null;

	const rawNote = formData.get('note');
	const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim().slice(0, 200) : null;

	const now = new Date();
	const rawWhen = formData.get('occurredAt');
	let occurredAt = now;
	if (typeof rawWhen === 'string' && rawWhen.trim()) {
		// A `datetime-local` value is wall-clock time in the user's own zone, and
		// reading it in the browser's would file the entry under the wrong orbit
		// for anybody travelling. The domain already knows how to do this.
		const parsed = options.timeZone ? parseLocalDateTime(rawWhen, options.timeZone) : null;
		if (!parsed) return null;
		occurredAt = parsed;
	}

	return { id, goalId: options.goalId, amount, note, occurredAt, createdAt: now };
}

/** An `enhance` submit function that logs online and queues when it cannot. */
export function logOrQueue(options: LogQueueOptions): SubmitFunction {
	return ({ formData, cancel }) => {
		const id = newEntryId();
		// Sent with the live submission too: if its answer goes missing, the
		// retry from the queue carries the same id and cannot double-count.
		formData.set('clientId', id);
		const draft = draftFrom(id, formData, options);

		options.onbusy?.(true);

		const queue = (entry: QueuedEntry) => {
			// Not awaited: the dial moves on the next tick from the queue's own
			// state, while the write and the flush attempt carry on behind it.
			void enqueue(entry);
			options.onbusy?.(false);
			options.onqueued?.(entry);
		};

		if (draft && typeof navigator !== 'undefined' && !navigator.onLine) {
			cancel();
			queue(draft);
			return;
		}

		return async (event) => {
			if (event.result.type === 'error' && draft) {
				queue(draft);
				return;
			}

			options.onbusy?.(false);
			if (options.onresult) return options.onresult(event);
			await event.update();
		};
	};
}
