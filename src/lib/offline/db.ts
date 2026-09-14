import { browser } from '$app/environment';
import type { QueuedEntry } from '$domain/queue';

/**
 * Where a queued entry waits, and the only part of offline logging that has to
 * outlive the tab.
 *
 * IndexedDB by hand rather than a wrapper library: this needs one store, four
 * operations and no indexes, which is less code than the import would be. Every
 * call resolves rather than rejects — a browser in a private window can refuse
 * storage outright, and an entry that cannot be written down is still worth
 * sending, so the queue falls back to memory and says so rather than losing the
 * log in an unhandled rejection.
 */

const DB_NAME = 'nova-offline';
const STORE = 'entries';
const VERSION = 1;

/** Timestamps are epoch milliseconds here too, so nothing stores a local time. */
interface StoredEntry {
	id: string;
	goalId: string;
	amount: number;
	note: string | null;
	occurredAt: number;
	createdAt: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
	if (!browser || typeof indexedDB === 'undefined') return Promise.resolve(null);

	opening ??= new Promise<IDBDatabase | null>((resolve) => {
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DB_NAME, VERSION);
		} catch {
			resolve(null);
			return;
		}
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});

	return opening;
}

function run<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
	return open().then(
		(db) =>
			new Promise<T | null>((resolve) => {
				if (!db) {
					resolve(null);
					return;
				}
				try {
					const tx = db.transaction(STORE, mode);
					const request = work(tx.objectStore(STORE));
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => resolve(null);
					tx.onabort = () => resolve(null);
				} catch {
					resolve(null);
				}
			})
	);
}

function toQueued(row: StoredEntry): QueuedEntry {
	return {
		id: row.id,
		goalId: row.goalId,
		amount: row.amount,
		note: row.note,
		occurredAt: new Date(row.occurredAt),
		createdAt: new Date(row.createdAt)
	};
}

/** Everything still waiting, oldest first — the order it was logged in. */
export async function readStored(): Promise<QueuedEntry[]> {
	const rows = (await run<StoredEntry[]>('readonly', (store) => store.getAll())) ?? [];
	return rows.map(toQueued).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** True if the entry is now written down and will survive a reload. */
export async function writeStored(entry: QueuedEntry): Promise<boolean> {
	const row: StoredEntry = {
		id: entry.id,
		goalId: entry.goalId,
		amount: entry.amount,
		note: entry.note,
		occurredAt: entry.occurredAt.getTime(),
		createdAt: entry.createdAt.getTime()
	};
	return (await run('readwrite', (store) => store.put(row))) !== null;
}

/** Drop one entry, once the server has it — or has refused it for good. */
export async function dropStored(id: string): Promise<void> {
	await run('readwrite', (store) => store.delete(id));
}
