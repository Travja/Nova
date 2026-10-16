import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoop } from './loop';

/** A hand-cranked `requestAnimationFrame`, so a test says exactly when frames happen. */
let queue: Map<number, FrameRequestCallback>;
let next = 1;

function tick(time = 0): number {
	const due = [...queue.values()];
	queue.clear();
	for (const callback of due) callback(time);
	return due.length;
}

beforeEach(() => {
	queue = new Map();
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = next++;
		queue.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createLoop', () => {
	it('draws nothing until asked, and stops when a frame wants no more', () => {
		const frame = vi.fn(() => false);
		const loop = createLoop(frame);

		expect(tick()).toBe(0);
		loop.request();
		loop.request();
		// Asked twice, drawn once: one frame is scheduled at most.
		expect(tick()).toBe(1);
		expect(tick()).toBe(0);
		expect(frame).toHaveBeenCalledTimes(1);
		expect(loop.frames).toBe(1);
	});

	it('keeps drawing while a frame says there is more, and stops when it says there is not', () => {
		let remaining = 3;
		const loop = createLoop(() => --remaining > 0);

		loop.request();
		expect(tick()).toBe(1);
		expect(tick()).toBe(1);
		expect(tick()).toBe(1);
		expect(tick()).toBe(0);
		expect(loop.frames).toBe(3);
	});

	it('holds a request made while paused until the last pause lifts', () => {
		const loop = createLoop(() => false);

		loop.pause('hidden', true);
		loop.pause('offscreen', true);
		loop.request();
		expect(tick()).toBe(0);

		loop.pause('hidden', false);
		expect(tick()).toBe(0);
		loop.pause('offscreen', false);
		expect(tick()).toBe(1);
		expect(loop.frames).toBe(1);
	});

	it('cancels a scheduled frame when paused, and draws it after', () => {
		const loop = createLoop(() => false);

		loop.request();
		loop.pause('lost', true);
		expect(tick()).toBe(0);
		loop.pause('lost', false);
		expect(tick()).toBe(1);
	});

	it('draws nothing once stopped', () => {
		const loop = createLoop(() => true);

		loop.request();
		loop.stop();
		expect(tick()).toBe(0);
		loop.request();
		expect(tick()).toBe(0);
	});

	it('paces a requested frame with a timer, waking on no raf in between', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let calls = 0;
		const loop = createLoop(() => {
			calls += 1;
			loop.requestPaced(30);
			return true;
		});

		loop.request();
		expect(tick()).toBe(1);
		expect(calls).toBe(1);
		// No raf is queued while the timer is waiting.
		expect(tick()).toBe(0);
		vi.advanceTimersByTime(29);
		expect(tick()).toBe(0);
		vi.advanceTimersByTime(1);
		expect(tick()).toBe(1);
		expect(calls).toBe(2);

		vi.useRealTimers();
	});

	it('a request() during a paced wait draws right away, not at the end of the wait', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let calls = 0;
		const loop = createLoop(() => {
			calls += 1;
			loop.requestPaced(30);
			return true;
		});

		loop.request();
		tick();
		expect(calls).toBe(1);
		// Interrupt the wait: this should not need the remaining 30ms to elapse.
		loop.request();
		expect(tick()).toBe(1);
		expect(calls).toBe(2);

		vi.useRealTimers();
	});

	it('a pause cancels a pending paced wait, same as a pending frame', () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		let calls = 0;
		const loop = createLoop(() => {
			calls += 1;
			loop.requestPaced(30);
			return true;
		});

		loop.request();
		tick();
		expect(calls).toBe(1);
		loop.pause('hidden', true);
		vi.advanceTimersByTime(1000);
		expect(tick()).toBe(0);
		expect(calls).toBe(1);

		loop.pause('hidden', false);
		expect(tick()).toBe(1);
		expect(calls).toBe(2);

		vi.useRealTimers();
	});

	it('picks up a request made from inside a frame', () => {
		let asked = false;
		const loop = createLoop(() => {
			if (!asked) {
				asked = true;
				loop.request();
			}
			return false;
		});

		loop.request();
		expect(tick()).toBe(1);
		expect(tick()).toBe(1);
		expect(tick()).toBe(0);
	});
});
