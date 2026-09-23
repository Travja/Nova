import { describe, expect, it } from 'vitest';
import { allBodies, BODY_VARIANTS, bodyVariant } from './bodies';
import { TIERS } from './tiers';

describe('bodyVariant golden values', () => {
	/**
	 * Pinned before the FNV-1a hash moved out to `$domain/hash` (#11 part A), so
	 * the move is provably a no-op: `bodyVariant` reads through `hash` now, and
	 * these numbers are what it returned before that change existed.
	 */
	it.each([
		['satellite', '0f6f2c3a-19a6-4a7f-9f4f-8a2c0a5d7b11', 1],
		['planet', 'goal-1', 2],
		['starSystem', 'a', 1],
		['galaxy', '1f2e3d4c-0000-4000-8000-000000000007', 0],
		['universe', 'asteroid-12', 1]
	] as const)('bodyVariant(%j, %j) is %i', (tier, id, expected) => {
		expect(bodyVariant(tier, id)).toBe(expected);
	});
});

describe('bodyVariant', () => {
	it('gives the same goal the same body every time', () => {
		const id = '0f6f2c3a-19a6-4a7f-9f4f-8a2c0a5d7b11';
		const first = bodyVariant('planet', id);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			expect(bodyVariant('planet', id)).toBe(first);
		}
	});

	it('stays inside the set its tier has', () => {
		for (const tier of TIERS) {
			for (let index = 0; index < 200; index += 1) {
				const variant = bodyVariant(tier, `goal-${index}`);
				expect(variant).toBeGreaterThanOrEqual(0);
				expect(variant).toBeLessThan(BODY_VARIANTS[tier]);
			}
		}
	});

	it('spreads goals across every body of a tier', () => {
		// Ids that differ by a character or two are the realistic case, and the
		// point of the whole change is that a dashboard is not one body repeated.
		const seen = new Set<number>();
		for (let index = 0; index < 60; index += 1) {
			seen.add(
				bodyVariant(
					'satellite',
					`1f2e3d4c-0000-4000-8000-00000000${String(index).padStart(4, '0')}`
				)
			);
		}
		expect(seen.size).toBe(BODY_VARIANTS.satellite);
	});

	it('answers with the first body when there is no goal yet', () => {
		// The goal form previews a body before the goal has an id to pin one to.
		for (const tier of TIERS) expect(bodyVariant(tier, '')).toBe(0);
	});
});

describe('allBodies', () => {
	it('lists every body of every tier once', () => {
		const bodies = allBodies();
		const total = TIERS.reduce((sum, tier) => sum + BODY_VARIANTS[tier], 0);
		expect(bodies).toHaveLength(total);
		expect(new Set(bodies.map((body) => `${body.tier}:${body.variant}`)).size).toBe(total);
	});
});
