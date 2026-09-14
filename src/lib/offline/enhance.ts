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

/**
 * Where a queued entry stands, in the order the caller learns it:
 *
 * - `logged`: in the queue's memory and drawn on the dial. Durability is not
 *   decided yet, so nothing here may say the entry is saved.
 * - `stored`: `writeStored` confirmed it reached IndexedDB.
 * - `unstored`: `writeStored` came back empty — this browser refused it, and
 *   the entry survives only until reload.
 */
export type QueuedState = 'logged' | 'stored' | 'unstored';

export interface LogQueueOptions {
	/** The goal being logged against. Read here rather than from the form,
	 *  because the goal page's action takes it from the route instead. */
	goalId: string;
	/** The user's zone, needed only where the form carries a `When` field. */
	timeZone?: string;
	/** Told when a submission starts and when it settles, for disabling controls. */
	onbusy?: (busy: boolean) => void;
	/**
	 * Called when the entry went to the queue rather than to the server, and
	 * again once its durability is known. `'logged'` fires the tick the dial
	 * moves; `'stored'` or `'unstored'` follows once the write has answered —
	 * never sooner, and never held up by the flush that comes after it.
	 */
	onqueued?: (entry: QueuedEntry, state: QueuedState) => void;
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
			options.onbusy?.(false);
			// Fires before the entry is even in IndexedDB: the dial has to move
			// here, so nothing durable can be claimed yet either.
			options.onqueued?.(entry, 'logged');
			// enqueue() puts the entry in the queue's own state synchronously —
			// that already happened by the time this line runs — and resolves
			// once writeStored has answered, without waiting on the flush behind
			// it. That resolution is the only honest moment to say "saved".
			void enqueue(entry).then((stored) => {
				options.onqueued?.(entry, stored ? 'stored' : 'unstored');
			});
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
