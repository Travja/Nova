import { describe, expect, it } from 'vitest';
import { hash } from './hash';

/**
 * Golden values, pinned before this moved out of `$domain/bodies` (#11 part
 * A). Anything that seeds from `hash` — `bodyVariant`, anchor angles, belt
 * rock placement — is only stable if this function itself never changes for
 * the same input, so these are asserted as fixed numbers rather than only
 * "the same twice": a refactor that quietly changes the algorithm passes the
 * self-consistency tests below and fails only this one.
 */
describe('hash golden values', () => {
	it.each([
		['', 2_166_136_261],
		['a', 3_826_002_220],
		['goal-1', 3_441_653_072],
		['0f6f2c3a-19a6-4a7f-9f4f-8a2c0a5d7b11', 2_089_351_699],
		['satellite-0', 773_455_663],
		['dwarf-0', 3_752_741_942],
		['asteroid-12', 3_977_434_480],
		['1f2e3d4c-0000-4000-8000-000000000007', 1_291_017_324]
	])('hash(%j) is %i', (key, expected) => {
		expect(hash(key)).toBe(expected);
	});
});

describe('hash', () => {
	it('is deterministic', () => {
		expect(hash('a-stable-id')).toBe(hash('a-stable-id'));
	});

	it('stays inside 32 bits', () => {
		for (const key of ['', 'x', 'a much longer key than the others', '🚀']) {
			const value = hash(key);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(0xff_ff_ff_ff);
		}
	});
});
