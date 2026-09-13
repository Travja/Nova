import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWEEP_MS, celebrationShape } from '$domain/celebration';
import type { GoalSnapshot } from '$domain/progress';
import { celebrationFor, noteOrbits } from './celebration.svelte';

/**
 * The store keeps one entry per goal for the life of the tab, so every test
 * here uses its own goal id rather than trying to reset module state.
 */
let ids = 0;
function newGoal(): string {
	ids += 1;
	return `goal-${ids}`;
}

const PERIOD = 'day:2026-09-13';

/** Only the handful of fields `noteOrbits` actually reads. */
function look(id: string, complete: boolean, period = PERIOD): GoalSnapshot {
	return {
		goal: { id, title: `Goal ${id}`, tier: 'satellite' },
		current: { period: { key: period }, complete, dormant: false }
	} as unknown as GoalSnapshot;
}

const SHAPE = celebrationShape('satellite');

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a closing waits for the body to get there', () => {
	it('raises nothing until the dial has finished its sweep', () => {
		const id = newGoal();
		noteOrbits([look(id, false)]);
		noteOrbits([look(id, true)]);

		// The arc is still filling and the body is still on its way round; a
		// burst now would fire where the body is going to be, not where it is.
		expect(celebrationFor(id)).toBeNull();

		vi.advanceTimersByTime(SWEEP_MS - 1);
		expect(celebrationFor(id)).toBeNull();

		vi.advanceTimersByTime(1);
		expect(celebrationFor(id)?.goalId).toBe(id);
	});

	it('still takes itself down once the burst has run', () => {
		const id = newGoal();
		noteOrbits([look(id, false)]);
		noteOrbits([look(id, true)]);

		vi.advanceTimersByTime(SWEEP_MS);
		expect(celebrationFor(id)).not.toBeNull();

		// The tail is measured from the burst starting, not from the log.
		vi.advanceTimersByTime(SHAPE.ms + 119);
		expect(celebrationFor(id)).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(celebrationFor(id)).toBeNull();
	});

	it('makes a second closing wait out its own sweep, not the tail of the first', () => {
		const first = newGoal();
		const second = newGoal();
		noteOrbits([look(first, false), look(second, false)]);

		noteOrbits([look(first, true), look(second, false)]);
		vi.advanceTimersByTime(SWEEP_MS);
		expect(celebrationFor(first)).not.toBeNull();

		// The second one lands while the first is still on screen: the first
		// goes now, and the second is not raised early in its place.
		noteOrbits([look(first, true), look(second, true)]);
		expect(celebrationFor(first)).toBeNull();
		expect(celebrationFor(second)).toBeNull();

		vi.advanceTimersByTime(SWEEP_MS);
		expect(celebrationFor(second)?.goalId).toBe(second);
	});

	it('leaves a redraw alone, so nothing is raised and nothing is pending', () => {
		const id = newGoal();
		// Already closed when this browser first looked: there is no closing to
		// have witnessed, now or a sweep later.
		noteOrbits([look(id, true)]);
		noteOrbits([look(id, true)]);

		vi.advanceTimersByTime(SWEEP_MS * 2);
		expect(celebrationFor(id)).toBeNull();
	});

	it('does not raise one for a period that rolled over', () => {
		const id = newGoal();
		noteOrbits([look(id, false, 'day:2026-09-13')]);
		noteOrbits([look(id, true, 'day:2026-09-14')]);

		vi.advanceTimersByTime(SWEEP_MS * 2);
		expect(celebrationFor(id)).toBeNull();
	});
});
