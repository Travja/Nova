import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';
import type { QueuedEntry } from '$domain/queue';
import { dropStored, readStored, writeStored } from './db';

/**
 * The browser's own log book.
 *
 * An entry that cannot be sent is written here instead of being lost, shown on
 * the dial it belongs to as though it had landed, and flushed the moment there
 * is a network again. Three things flush it: the service worker's Background
 * Sync replay (which works with the tab closed, and which Safari does not
 * have), the `online` event, and the page coming back to the foreground —
 * belt, braces and a third pair of braces, because the cost of a queue that
 * never drains is silently losing somebody's week.
 *
 * All three can deliver the same entry twice. That is not defended against
 * here: every entry carries the id it was born with and the insert conflicts
 * on it, so a double delivery is a no-op on the server rather than a
 * double-count. See `logEntry()`.
 *
 * The maths of what a queued entry does to an orbit lives in `$domain/queue`,
 * which is pure and knows nothing about any of this.
 */

/** Where a flush goes. One line of answer per entry. */
const FLUSH_URL = '/api/entries';

interface QueueItem extends QueuedEntry {
	/**
	 * `pending` is waiting or being retried; `sent` has been confirmed and is
	 * only still here so the dial does not flicker while the page reloads its
	 * data; `failed` was refused for a reason retrying will not change.
	 */
	status: 'pending' | 'sent' | 'failed';
	/** Why it was refused. Only on `failed`. */
	reason?: string;
}

let items = $state<QueueItem[]>([]);
let announcement = $state('');
let syncing = $state(false);
/** False once a browser has refused to store the queue, so the UI can say so. */
let durable = $state(true);
let started = false;

function count(total: number, one: string, many: string): string {
	return `${total} ${total === 1 ? one : many}`;
}

function entries(total: number): string {
	return count(total, 'entry', 'entries');
}

/** A fresh client id. The id is the whole idempotency story, so it has to be unique. */
export function newEntryId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Older Safari outside a secure context. Not as good, still far beyond
	// collision within one device's queue.
	return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Entries the screen should draw as though they had landed. */
export function queuedEntries(): QueuedEntry[] {
	return items.filter((item) => item.status !== 'failed');
}

/** How many of this goal's entries are still waiting, for the pending badge. */
export function pendingFor(goalId: string): number {
	return items.filter((item) => item.status === 'pending' && item.goalId === goalId).length;
}

/** How many entries are waiting in all. */
export function waiting(): number {
	return items.filter((item) => item.status === 'pending').length;
}

/** Entries the server refused. They are not coming back on their own. */
export function rejected(): QueueItem[] {
	return items.filter((item) => item.status === 'failed');
}

/** The last thing that happened to the queue, for the live region. */
export function queueAnnouncement(): string {
	return announcement;
}

/** True while a flush is in flight, so the bar can say it is trying. */
export function isSyncing(): boolean {
	return syncing;
}

/** False when the browser refused to store the queue — it survives until reload only. */
export function isDurable(): boolean {
	return durable;
}

/** Stop reporting entries the server refused, once they have been read. */
export function dismissRejected(): void {
	items = items.filter((item) => item.status !== 'failed');
	announcement = '';
}

/**
 * Take an entry the server could not be told about.
 *
 * Written down before anything else: a log that is only in memory does not
 * survive the reload that a flaky connection tends to come with.
 */
export async function enqueue(entry: QueuedEntry): Promise<void> {
	items = [...items, { ...entry, status: 'pending' }];
	const stored = await writeStored(entry);
	if (!stored) durable = false;

	const total = waiting();
	announcement = durable
		? `Saved on this device. ${entries(total)} waiting to sync.`
		: `Saved for now — this browser will not keep it if you reload. ${entries(total)} waiting to sync.`;

	await flush();
}

interface FlushResult {
	clientId: string;
	status: 'logged' | 'rejected';
	reason?: string;
}

/**
 * How long one attempt is given.
 *
 * A request that fails is easy. A request that neither fails nor answers is the
 * one that costs: a captive portal, a lift, or a service worker holding a POST
 * open. Without this the queue would sit on a promise that never settles and
 * never try again.
 */
const ATTEMPT_TIMEOUT_MS = 15_000;

/**
 * How long to wait before trying again, per consecutive failure.
 *
 * `online` fires when the operating system believes there is a network, which
 * is a second or two before there reliably is one — and a captive portal can
 * make that minutes. One attempt per browser event would leave entries sitting
 * in the queue until something else happened to wake it, so a failure books its
 * own next attempt, backing off to a trickle rather than hammering a network
 * that is plainly not there.
 */
const RETRY_STEPS_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

/** The attempt in flight, so a second trigger does not send the batch twice. */
let attempt: AbortController | null = null;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleRetry(): void {
	clearTimeout(retryTimer);
	if (!browser || waiting() === 0) return;

	const delay = RETRY_STEPS_MS[Math.min(retries, RETRY_STEPS_MS.length - 1)];
	retries += 1;
	retryTimer = setTimeout(() => flush(), delay);
}

/** Stop retrying — the queue is empty, or somebody else is about to try. */
function stopRetrying(): void {
	clearTimeout(retryTimer);
	retryTimer = undefined;
}

/** Post the pending entries and act on what comes back. */
async function send(signal: AbortSignal): Promise<void> {
	const batch = items.filter((item) => item.status === 'pending');
	if (batch.length === 0) return;

	const response = await fetch(FLUSH_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		signal,
		body: JSON.stringify({
			entries: batch.map((item) => ({
				clientId: item.id,
				goalId: item.goalId,
				amount: item.amount,
				note: item.note,
				// The instant it was made. Nothing downstream restamps it.
				occurredAt: item.occurredAt.toISOString()
			}))
		})
	});

	// Something answered, so the network is real; the next failure starts its
	// backoff again from the top rather than from where the last one left off.
	retries = 0;

	if (response.status === 401) {
		announcement = `Sign in again to sync ${entries(batch.length)}.`;
		return;
	}
	// Server trouble rather than a refusal. The entries stay queued.
	if (!response.ok) return;

	const body = (await response.json().catch(() => null)) as { results?: FlushResult[] } | null;
	const answers = new Map((body?.results ?? []).map((result) => [result.clientId, result]));

	let landed = 0;
	const refused: string[] = [];
	for (const item of batch) {
		const answer = answers.get(item.id);
		// An entry the server did not mention is still ours to carry.
		if (!answer) continue;

		// Dropped from storage first: whatever happens next, this entry must
		// never be sent a second time by a later reload.
		await dropStored(item.id);
		if (answer.status === 'logged') {
			item.status = 'sent';
			landed += 1;
		} else {
			item.status = 'failed';
			item.reason = answer.reason;
			refused.push(answer.reason ?? 'Nova could not record it.');
		}
	}

	if (landed > 0 || refused.length > 0) {
		const synced = landed > 0 ? `${entries(landed)} synced.` : '';
		const lost =
			refused.length > 0 ? ` ${entries(refused.length)} could not be synced: ${refused[0]}` : '';
		announcement = `${synced}${lost}`.trim();
	}
}

/**
 * Replace the browser's estimate with the server's own numbers, and only then
 * stop drawing the entries it has confirmed — dropping them first would dip
 * every dial back for as long as the reload took.
 *
 * Skipped while the browser says it is offline. A load that cannot reach the
 * network can still be answered from the page cache, and swapping a correct
 * overlay for a stale page would lose the entry on screen for as long as the
 * connection stays down.
 */
async function settle(): Promise<void> {
	if (!items.some((item) => item.status === 'sent')) return;
	if (typeof navigator !== 'undefined' && !navigator.onLine) return;

	const refreshed = await invalidateAll().then(
		() => true,
		() => false
	);
	if (refreshed) items = items.filter((item) => item.status !== 'sent');
}

/**
 * Try to empty the queue.
 *
 * The request is sent even when the browser says it is offline, and
 * deliberately so: that is what gives the service worker's Background Sync
 * plugin a failed request to hold on to and replay after the tab is gone.
 * Where there is no Background Sync the attempt simply fails and the entry
 * stays queued for the next `online` or focus.
 *
 * Pass `restart` when the thing that triggered this was connectivity itself:
 * an attempt made against a network that has since changed is worth abandoning
 * rather than waiting out.
 */
export async function flush(restart = false): Promise<void> {
	if (!browser) return;
	if (attempt) {
		if (!restart) return;
		attempt.abort();
	}

	stopRetrying();
	const controller = new AbortController();
	attempt = controller;
	const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
	syncing = true;

	try {
		await send(controller.signal);
		await settle();
	} catch {
		// Offline, aborted, or the request never arrived. Nothing is dropped.
	} finally {
		clearTimeout(timer);
		// A newer attempt has already taken over; leave its state alone.
		if (attempt === controller) {
			attempt = null;
			syncing = false;
			// Books the next attempt, or stands down if there is nothing left.
			scheduleRetry();
		}
	}
}

/**
 * Load what the last session left behind and watch for a chance to send it.
 *
 * `online` is the obvious signal and the one browsers lie about most, so
 * visibility and focus back it up: coming back to a tab is the moment a phone
 * has usually just found signal again, and it is the only signal Safari offers
 * that is worth anything.
 */
export function startQueue(): () => void {
	if (!browser || started) return () => undefined;
	started = true;

	readStored().then((stored) => {
		// A list rather than a Set: a queue is a handful of entries, and this runs
		// once per tab.
		const known = items.map((item) => item.id);
		const restored = stored
			.filter((entry) => !known.includes(entry.id))
			.map((entry): QueueItem => ({ ...entry, status: 'pending' }));
		if (restored.length > 0) {
			items = [...restored, ...items];
			announcement = `${entries(restored.length)} logged offline, waiting to sync.`;
		}
		return flush();
	});

	const onVisible = () => {
		if (document.visibilityState === 'visible') flush();
	};
	// A connectivity change is the one trigger allowed to abandon an attempt in
	// flight — that attempt was made against a network that no longer exists.
	const onOnline = () => flush(true);

	window.addEventListener('online', onOnline);
	window.addEventListener('focus', onOnline);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		window.removeEventListener('online', onOnline);
		window.removeEventListener('focus', onOnline);
		document.removeEventListener('visibilitychange', onVisible);
		stopRetrying();
		started = false;
	};
}
