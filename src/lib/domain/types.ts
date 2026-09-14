import type { Tier } from './tiers';

/** How a goal's progress is measured. */
export type MetricKind = 'count' | 'duration' | 'checkin';

export interface MetricDefinition {
	kind: MetricKind;
	/**
	 * Unit shown next to amounts, e.g. `pages`, `workouts`. Durations are always
	 * stored in minutes and rendered as hours/minutes, so the unit is ignored.
	 */
	unit: string;
}

export interface Goal {
	id: string;
	userId: string;
	title: string;
	description: string | null;
	tier: Tier;
	metric: MetricDefinition;
	/** Amount needed to close one orbit, in the metric's own units. */
	target: number;
	/** Hex colour for the body and its trail. */
	color: string;
	sortOrder: number;
	createdAt: Date;
	archivedAt: Date | null;
	/**
	 * The goal this one feeds, in a strictly longer tier, or null for a goal
	 * that stands alone. A parent counts the closed orbits of its direct
	 * children rather than anything logged against it — see `$domain/nesting`.
	 */
	parentId: string | null;
}

export interface ProgressEntry {
	id: string;
	goalId: string;
	/** Amount logged, in the metric's units. Negative values correct mistakes. */
	amount: number;
	note: string | null;
	occurredAt: Date;
	createdAt: Date;
}

export interface UserProfile {
	id: string;
	email: string;
	displayName: string;
	timeZone: string;
	/** 0 = Sunday … 6 = Saturday. */
	weekStartsOn: number;
}
