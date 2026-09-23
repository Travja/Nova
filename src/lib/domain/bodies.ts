import { hash } from './hash';
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
