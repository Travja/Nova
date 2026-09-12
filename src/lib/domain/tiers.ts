/**
 * Nova's goal tiers are orbital scales. Each tier is a body orbiting the one
 * above it, and the size of the orbit maps to how long one revolution takes.
 */
export const TIERS = ['satellite', 'planet', 'starSystem', 'galaxy', 'universe'] as const;

export type Tier = (typeof TIERS)[number];

/** The calendar window that one full orbit is measured against. */
export type Cadence = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface TierDefinition {
	id: Tier;
	/** Display name. */
	label: string;
	/** What the body in this tier orbits — used in copy and empty states. */
	orbits: string;
	cadence: Cadence;
	/** One-line explanation shown when picking a tier. */
	blurb: string;
	/** Accent colour for rings, arcs and glows. */
	accent: string;
	/** Relative ring size on the dashboard, 0-1. */
	scale: number;
}

export const TIER_DEFINITIONS: Record<Tier, TierDefinition> = {
	satellite: {
		id: 'satellite',
		label: 'Satellite',
		orbits: 'a planet',
		cadence: 'day',
		blurb: 'Small, quick wins. One orbit every day.',
		accent: '#7dd3fc',
		scale: 0.55
	},
	planet: {
		id: 'planet',
		label: 'Planet',
		orbits: 'a star',
		cadence: 'week',
		blurb: 'Habits that add up. One orbit every week.',
		accent: '#a78bfa',
		scale: 0.7
	},
	starSystem: {
		id: 'starSystem',
		label: 'Star System',
		orbits: 'the galactic core',
		cadence: 'month',
		blurb: 'Bigger pushes. One orbit every month.',
		accent: '#fbbf24',
		scale: 0.82
	},
	galaxy: {
		id: 'galaxy',
		label: 'Galaxy',
		orbits: 'a cluster',
		cadence: 'quarter',
		blurb: 'Season-long ambitions. One orbit every quarter.',
		accent: '#f472b6',
		scale: 0.92
	},
	universe: {
		id: 'universe',
		label: 'Universe',
		orbits: 'everything',
		cadence: 'year',
		blurb: 'The long haul. One orbit every year.',
		accent: '#34d399',
		scale: 1
	}
};

export const TIER_LIST: TierDefinition[] = TIERS.map((tier) => TIER_DEFINITIONS[tier]);

export function isTier(value: unknown): value is Tier {
	return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

export function cadenceOf(tier: Tier): Cadence {
	return TIER_DEFINITIONS[tier].cadence;
}

/** Human label for a single revolution in this tier, e.g. "this week". */
export const CADENCE_LABEL: Record<Cadence, string> = {
	day: 'today',
	week: 'this week',
	month: 'this month',
	quarter: 'this quarter',
	year: 'this year'
};
