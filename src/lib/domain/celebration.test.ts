import { describe, expect, it } from 'vitest';
import { celebrationShape, isFreshClosing, rayAngles, type OrbitMark } from './celebration';
import { TIERS } from './tiers';

function mark(overrides: Partial<OrbitMark> = {}): OrbitMark {
	return { key: 'week:2026-W37', complete: false, dormant: false, ...overrides };
}

describe('isFreshClosing', () => {
	it('fires when an open orbit closes', () => {
		expect(isFreshClosing(mark(), mark({ complete: true }))).toBe(true);
	});

	it('stays quiet on a re-render of an orbit that is already closed', () => {
		expect(isFreshClosing(mark({ complete: true }), mark({ complete: true }))).toBe(false);
	});

	it('stays quiet the first time a closed orbit is seen', () => {
		// A page load, or navigating to a goal that closed yesterday: there is
		// nothing to compare against, so nothing was witnessed closing.
		expect(isFreshClosing(undefined, mark({ complete: true }))).toBe(false);
	});

	it('stays quiet when the period rolled over between looks', () => {
		const previous = mark({ key: 'week:2026-W36', complete: false });
		expect(isFreshClosing(previous, mark({ key: 'week:2026-W37', complete: true }))).toBe(false);
	});

	it('stays quiet while the orbit is still open', () => {
		expect(isFreshClosing(mark(), mark())).toBe(false);
	});

	it('stays quiet when an entry is removed and the orbit reopens', () => {
		expect(isFreshClosing(mark({ complete: true }), mark())).toBe(false);
	});

	it('never celebrates a period the goal spent archived', () => {
		const previous = mark();
		expect(isFreshClosing(previous, mark({ complete: true, dormant: true }))).toBe(false);
	});
});

describe('celebrationShape', () => {
	it('is over inside a second for every tier', () => {
		for (const tier of TIERS) expect(celebrationShape(tier).ms).toBeLessThan(1000);
	});

	it('grows with the tier, so a year does not close like a day', () => {
		const shapes = TIERS.map((tier) => celebrationShape(tier));
		for (let index = 1; index < shapes.length; index += 1) {
			expect(shapes[index].ms).toBeGreaterThan(shapes[index - 1].ms);
			expect(shapes[index].rays).toBeGreaterThanOrEqual(shapes[index - 1].rays);
			expect(shapes[index].reach).toBeGreaterThan(shapes[index - 1].reach);
		}
	});

	it('gives a satellite a spark and a universe something to stop for', () => {
		expect(celebrationShape('satellite')).toEqual({ ms: 620, rays: 6, reach: 2.2 });
		expect(celebrationShape('universe')).toEqual({ ms: 960, rays: 16, reach: 4.4 });
	});
});

describe('rayAngles', () => {
	it('spreads the rays evenly round the body', () => {
		expect(rayAngles(4)).toEqual([0, 90, 180, 270]);
	});
});
