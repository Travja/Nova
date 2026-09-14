import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedEntry } from '$domain/queue';

/**
 * `logOrQueue` only ever calls `enqueue` and `newEntryId` from `./queue.svelte`,
 * so mocking that module is enough to drive the durability sequence without
 * IndexedDB or a browser: exactly the seam #40 turns on. `enqueue`'s own
 * behaviour — that it resolves once written, not once flushed — is `enqueue`'s
 * contract to keep; this only checks that `logOrQueue` respects the promise it
 * is given rather than the tick it was called on.
 */
vi.mock('./queue.svelte', () => ({
	enqueue: vi.fn(),
	newEntryId: () => 'entry-1'
}));

import { logOrQueue } from './enhance';
import { enqueue } from './queue.svelte';

const enqueueMock = vi.mocked(enqueue);

function formDataFor(amount: string): FormData {
	const data = new FormData();
	data.set('amount', amount);
	return data;
}

beforeEach(() => {
	enqueueMock.mockReset();
	vi.stubGlobal('navigator', { onLine: false });
});

describe('logging while offline', () => {
	it('says "logged" the instant the entry queues, before durability is known', () => {
		let resolveWrite!: (stored: boolean) => void;
		enqueueMock.mockReturnValue(
			new Promise<boolean>((resolve) => {
				resolveWrite = resolve;
			})
		);

		const states: Array<[QueuedEntry, string]> = [];
		const submit = logOrQueue({
			goalId: 'goal-1',
			onqueued: (entry, state) => states.push([entry, state])
		});

		submit({ formData: formDataFor('5'), cancel: () => undefined } as never);

		// The dial-moving beat has already happened; the write has not settled.
		expect(states).toHaveLength(1);
		expect(states[0][1]).toBe('logged');

		resolveWrite(true);
	});

	it('upgrades to "stored" only once the write resolves true', async () => {
		let resolveWrite!: (stored: boolean) => void;
		enqueueMock.mockReturnValue(
			new Promise<boolean>((resolve) => {
				resolveWrite = resolve;
			})
		);

		const states: string[] = [];
		const submit = logOrQueue({
			goalId: 'goal-1',
			onqueued: (_entry, state) => states.push(state)
		});
		submit({ formData: formDataFor('5'), cancel: () => undefined } as never);

		expect(states).toEqual(['logged']);

		resolveWrite(true);
		await Promise.resolve();
		await Promise.resolve();

		expect(states).toEqual(['logged', 'stored']);
	});

	it('reports "unstored" on first paint of the durability claim when storage is refused', async () => {
		let resolveWrite!: (stored: boolean) => void;
		enqueueMock.mockReturnValue(
			new Promise<boolean>((resolve) => {
				resolveWrite = resolve;
			})
		);

		const states: string[] = [];
		const submit = logOrQueue({
			goalId: 'goal-1',
			onqueued: (_entry, state) => states.push(state)
		});
		submit({ formData: formDataFor('5'), cancel: () => undefined } as never);

		// Nothing has claimed durability yet — 'logged' promises nothing.
		expect(states).toEqual(['logged']);

		resolveWrite(false);
		await Promise.resolve();
		await Promise.resolve();

		// The very first (and only) durability-bearing state is the true one.
		expect(states).toEqual(['logged', 'unstored']);
	});

	it('never reports a durability state before enqueue settles, however long the write takes', async () => {
		let resolveWrite!: (stored: boolean) => void;
		const writePromise = new Promise<boolean>((resolve) => {
			resolveWrite = resolve;
		});
		enqueueMock.mockReturnValue(writePromise);

		const states: string[] = [];
		const submit = logOrQueue({
			goalId: 'goal-1',
			onqueued: (_entry, state) => states.push(state)
		});
		submit({ formData: formDataFor('5'), cancel: () => undefined } as never);

		// Several microtask turns pass with the write still pending: still just
		// the optimistic beat, never a durability claim.
		for (let i = 0; i < 5; i += 1) await Promise.resolve();
		expect(states).toEqual(['logged']);

		resolveWrite(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(states).toEqual(['logged', 'stored']);
	});
});
