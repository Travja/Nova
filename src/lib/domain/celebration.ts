import { TIER_DEFINITIONS, type Tier } from './tiers';

/**
 * When a closing orbit is worth a moment, and how big that moment should be.
 *
 * Closing an orbit is the best thing that happens in Nova, and it happens once
 * per period — so it has to fire on the closing itself and never on a re-render
 * or a revisit. That decision is made here, on plain data, rather than inside a
 * component where it would be tangled up with when Svelte happens to run.
 */

/** The little of an orbit that decides whether a closing just happened. */
export interface OrbitMark {
	/** The period key, so a rollover is never mistaken for progress. */
	key: string;
	complete: boolean;
	dormant: boolean;
}

/**
 * Whether `next` closed an orbit that `previous` had open.
 *
 * `previous` is what this browser last saw for the same goal, so everything
 * that is not a closing observed first-hand answers false: a goal that was
 * already closed when the page loaded (nothing to compare against), a period
 * that rolled over between the two looks, an orbit that is still open, and a
 * period the goal spent archived, which was never flying to begin with.
 */
export function isFreshClosing(previous: OrbitMark | undefined, next: OrbitMark): boolean {
	if (!next.complete || next.dormant) return false;
	if (!previous || previous.key !== next.key) return false;
	return !previous.complete;
}

/**
 * How long a dial takes to sweep to a new reading.
 *
 * The arc fills and the body travels round to meet it over this, together,
 * because position and fill are the same fact and a dial that animates one and
 * jumps the other contradicts itself for the length of the sweep.
 *
 * It is also how long a closing waits before it is raised. A burst that fires
 * where the body is *going* to be, while the body is still on its way there,
 * reads as two things happening rather than one — so the celebration lands when
 * the body arrives. `OrbitDial` spends this and the store waits it out, both
 * from here, so the two cannot drift apart.
 */
export const SWEEP_MS = 700;

/** How big a closing should feel, given the tier that closed. */
export interface CelebrationShape {
	/** How long the whole thing lasts. Always under a second. */
	ms: number;
	/** Rays in the starburst. */
	rays: number;
	/** How far the burst reaches, as a multiple of the body's own radius. */
	reach: number;
}

const SMALLEST = TIER_DEFINITIONS.satellite.scale;
const LARGEST = TIER_DEFINITIONS.universe.scale;

/** Where a tier sits between the smallest orbit and the largest, 0-1. */
function ramp(scale: number, low: number, high: number): number {
	return low + ((scale - SMALLEST) / (LARGEST - SMALLEST)) * (high - low);
}

/**
 * A satellite closes every day and should feel like a spark; a universe closes
 * once a year and should stop you. Both are over inside a second, because a
 * celebration you have to wait out stops being one on the third day.
 */
export function celebrationShape(tier: Tier): CelebrationShape {
	const { scale } = TIER_DEFINITIONS[tier];
	return {
		ms: Math.round(ramp(scale, 620, 960)),
		rays: Math.round(ramp(scale, 6, 16)),
		reach: Number(ramp(scale, 2.2, 4.4).toFixed(2))
	};
}

/** Evenly spaced ray angles, in degrees clockwise from the top. */
export function rayAngles(count: number): number[] {
	return Array.from({ length: count }, (_, index) => (index * 360) / count);
}
