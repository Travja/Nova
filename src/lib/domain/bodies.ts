import { TIERS, type Tier } from './tiers';

/**
 * Which body inside a tier a goal flies.
 *
 * A tier is a family, not a stamp: every satellite being the same comsat makes a
 * dashboard of six goals look like one goal drawn six times. Each tier has a
 * handful of bodies and a goal keeps the one it is given.
 *
 * Pinned by hashing the goal's id rather than stored on the row, so there is no
 * column to migrate and no way for a body to change under a goal that has been
 * flying for a year. Ids never change; titles, colours and tiers do.
 */

/** How many bodies each tier can be drawn as. */
export const BODY_VARIANTS: Record<Tier, number> = {
	satellite: 3,
	planet: 3,
	starSystem: 3,
	galaxy: 3,
	universe: 3
};

/**
 * FNV-1a, which is short, has no dependencies and scatters ids that differ by a
 * character or two — which is exactly what a run of uuids does.
 */
function hash(key: string): number {
	let value = 2_166_136_261;
	for (let index = 0; index < key.length; index += 1) {
		value ^= key.charCodeAt(index);
		// The FNV prime, by shifts, so this stays inside 32 bits.
		value =
			(value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
	}
	return value >>> 0;
}

/**
 * The body this goal flies, as an index into its tier's set.
 *
 * An empty key answers with the first body of the tier: the goal form's preview
 * draws one before the goal has an id to be pinned to.
 */
export function bodyVariant(tier: Tier, key: string): number {
	const count = BODY_VARIANTS[tier];
	if (!key) return 0;
	return hash(key) % count;
}

/** Every body of every tier, for anything that wants to show the whole set. */
export function allBodies(): { tier: Tier; variant: number }[] {
	return TIERS.flatMap((tier) =>
		Array.from({ length: BODY_VARIANTS[tier] }, (_, variant) => ({ tier, variant }))
	);
}
