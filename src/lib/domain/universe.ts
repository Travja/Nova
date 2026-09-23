import { driftBand, driftFraction, sortBelt, type DriftBand, type DriftInput } from './asteroids';
import { hash } from './hash';
import type { GoalSnapshot } from './progress';
import { TIERS, type Tier } from './tiers';

/**
 * The universe: a tree of hosts and orbits, built from a pilot's goals.
 *
 * Every goal orbits something — its parent goal, or, when it has none, an
 * **anchor** of the kind its tier's definition already says it orbits
 * (`TIER_DEFINITIONS[tier].orbits`). Anchors are scenery: grey, dim, never
 * tappable, and created only when a loose goal needs one. See
 * `docs/issues/11-system-view.md` for the full design; this file is the pure
 * half of it — no three.js, no DOM, no server. `src/lib/universe/` (part B)
 * draws what this computes.
 *
 * Everything here is deterministic: the same snapshots and asteroids always
 * build the same tree, because nothing but `hash()` stands in for randomness
 * and `hash()` is seeded from ids rather than the clock.
 */

/** How long one full lap takes for a closed orbit, in seconds. Part B's frame loop reads this. */
export const UNIVERSE_LAP_SECONDS: Record<Tier, number> = {
	satellite: 16,
	planet: 40,
	starSystem: 90,
	galaxy: 240,
	universe: 900
};

/** Loose goals one anchor takes before a second anchor of its kind opens. */
export const ANCHOR_CAPACITY = 6;

/** The kinds of scenery a loose goal, or another anchor, can orbit. */
export type AnchorKind = 'dwarf' | 'star' | 'core' | 'cluster' | 'home' | 'multiverse';

/** What a loose goal of each tier orbits. */
const ANCHOR_FOR: Record<Tier, AnchorKind> = {
	satellite: 'dwarf',
	planet: 'star',
	starSystem: 'core',
	galaxy: 'cluster',
	universe: 'multiverse'
};

/** What each anchor itself orbits, all the way up to the multiverse's barycentre. */
const ANCHOR_PARENT: Record<Exclude<AnchorKind, 'multiverse'>, AnchorKind> = {
	dwarf: 'star',
	star: 'core',
	core: 'cluster',
	cluster: 'home',
	home: 'multiverse'
};

/** Where a tier sits on the ladder, for sorting siblings innermost first. */
const TIER_RANK: Record<Tier, number> = Object.fromEntries(
	TIERS.map((tier, index) => [tier, index])
) as Record<Tier, number>;

/**
 * How big each kind is, whatever it holds. Children can only make it larger.
 *
 * A Galaxy goal with nothing in it is exactly as large as the home galaxy
 * beside it, and a universe is more than ten galaxies across even when it is
 * empty — see decision 2 in the spec for why sizing follows the rung rather
 * than the contents.
 */
export const MIN_EXTENT: Record<Tier | AnchorKind, number> = {
	satellite: 0.28,
	dwarf: 0.6,
	planet: 0.9,
	star: 2.2,
	starSystem: 14,
	galaxy: 240,
	core: 240,
	cluster: 0,
	universe: 2600,
	home: 2600,
	multiverse: 0
};

/** Radius of the body at a host's own centre, in scene units. */
const BODY_RADIUS: Record<Tier | AnchorKind, number> = {
	satellite: 0.28,
	planet: 0.9,
	starSystem: 2.4,
	galaxy: 7,
	universe: 30,
	dwarf: 0.6,
	star: 2.2,
	core: 7,
	cluster: 10,
	home: 30,
	multiverse: 12
};

/** One rock on the belt round the home star. */
export interface BeltRock {
	id: string;
	/** Fixed, seeded from the asteroid's id — rocks do not move. */
	angle: number;
	/** Belt's inner edge plus how far this rock has drifted outward. */
	radius: number;
	band: DriftBand;
}

/** The belt round the home star. Never on any other node. */
export interface Belt {
	inner: number;
	width: number;
	/** At most 30, oldest drift anchor first. */
	rocks: BeltRock[];
}

export interface UniverseNode {
	/** Goal id, or `${kind}-${index}` for an anchor. */
	id: string;
	kind: Tier | AnchorKind;
	/** Null for an anchor. */
	goalId: string | null;
	bodyRadius: number;
	/** Body, or outermost orbit, whichever is further. */
	extent: number;
	/** 0 for the root. */
	orbitRadius: number;
	/** Radians: progress for a goal, seeded for an anchor. */
	angle: number;
	/** The trail's length, 0–1. */
	fraction: number;
	closed: boolean;
	dormant: boolean;
	/** This node's own orbital plane, seeded. */
	tilt: number;
	spin: number;
	children: UniverseNode[];
	/** Only ever on the home star. */
	belt: Belt | null;
}

/** A tiny LCG, seeded from `hash()`, so every seeded angle is reproducible. */
function seeded(seed: number): () => number {
	let state = seed % 2_147_483_648;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

/** A node mid-build: every `UniverseNode` field, plus what the build needs and the public shape does not. */
interface Draft extends Omit<UniverseNode, 'children'> {
	isAnchor: boolean;
	/** How many loose goals (or subordinate anchors) this anchor already carries. Unused on a goal. */
	loose: number;
	/** Where this goal sits in the pilot's own order. Unused on an anchor. */
	sortOrder: number;
	tierRank: number;
	children: Draft[];
}

function makeAnchor(kind: AnchorKind, index: number): Draft {
	return {
		id: `${kind}-${index}`,
		kind,
		goalId: null,
		isAnchor: true,
		loose: 0,
		sortOrder: 0,
		tierRank: -1,
		bodyRadius: BODY_RADIUS[kind],
		extent: 0,
		orbitRadius: 0,
		angle: 0,
		fraction: 0,
		closed: false,
		dormant: false,
		tilt: 0,
		spin: 0,
		children: [],
		belt: null
	};
}

function makeGoalNode(snapshot: GoalSnapshot): Draft {
	const { goal, current } = snapshot;
	return {
		id: goal.id,
		kind: goal.tier,
		goalId: goal.id,
		isAnchor: false,
		loose: 0,
		sortOrder: goal.sortOrder,
		tierRank: TIER_RANK[goal.tier],
		bodyRadius: BODY_RADIUS[goal.tier],
		extent: 0,
		orbitRadius: 0,
		angle: current.fraction * Math.PI * 2,
		fraction: current.fraction,
		closed: current.complete,
		dormant: current.dormant,
		tilt: 0,
		spin: 0,
		children: [],
		belt: null
	};
}

/** Children innermost first: anchors before goals, then by tier, then by the pilot's own order. */
function byLayoutOrder(a: Draft, b: Draft): number {
	if (a.isAnchor !== b.isAnchor) return a.isAnchor ? -1 : 1;
	if (a.isAnchor) return 0;
	return a.tierRank - b.tierRank || a.sortOrder - b.sortOrder;
}

/**
 * Orbit radii, innermost first, each lane as wide as what is in it — the flat
 * sky's lane rule, applied recursively (decision 4). Also assigns this node's
 * own seeded tilt, spin and (for an anchor) angle, and folds in the belt when
 * this is the home star.
 */
function layout(node: Draft): void {
	node.children.sort(byLayoutOrder);

	let edge = node.bodyRadius * 1.9;
	for (const child of node.children) {
		layout(child);
		const gap = Math.max(child.extent * 0.45, node.bodyRadius * 0.35);
		child.orbitRadius = edge + gap + child.extent;
		edge = child.orbitRadius + child.extent;
	}

	if (node.belt) {
		node.belt.inner = edge + node.bodyRadius * 1.2;
		node.belt.width = node.bodyRadius * 2.2;
		edge = node.belt.inner + node.belt.width;
	}

	node.extent = Math.max(
		node.children.length > 0 || node.belt ? edge : node.bodyRadius,
		MIN_EXTENT[node.kind] ?? node.bodyRadius
	);

	const random = seeded(hash(node.id));
	node.tilt = (random() - 0.5) * 0.7;
	node.spin = random() * Math.PI * 2;
	if (node.isAnchor && node.kind !== 'multiverse') node.angle = random() * Math.PI * 2;
}

function toPublic(node: Draft): UniverseNode {
	return {
		id: node.id,
		kind: node.kind,
		goalId: node.goalId,
		bodyRadius: node.bodyRadius,
		extent: node.extent,
		orbitRadius: node.orbitRadius,
		angle: node.angle,
		fraction: node.fraction,
		closed: node.closed,
		dormant: node.dormant,
		tilt: node.tilt,
		spin: node.spin,
		children: node.children.map(toPublic),
		belt: node.belt
	};
}

export interface UniverseTree {
	root: UniverseNode;
	/** The home star — where the daily and weekly goals are — or null when there is none. */
	home: UniverseNode | null;
	/** The galactic core — the "Galaxy" zoom stop — or null when there is none. */
	galaxy: UniverseNode | null;
}

/**
 * Build the universe: every goal orbiting its parent or the anchor its tier
 * orbits, laid out in lanes so nothing overlaps, with a belt round the home
 * star when there are active asteroids.
 *
 * `snapshots` should already exclude archived goals — `listGoalSnapshots()`
 * does — so a goal whose parent was archived falls out of `nodes` and orbits
 * an anchor like any other loose goal, per decision 3.
 */
export function universeTree(
	snapshots: readonly GoalSnapshot[],
	asteroids: readonly (DriftInput & { id: string })[],
	now: Date
): UniverseTree {
	const root = makeAnchor('multiverse', 0);
	const nodes = new Map<string, Draft>();
	for (const snapshot of snapshots) nodes.set(snapshot.goal.id, makeGoalNode(snapshot));

	const anchors: Record<Exclude<AnchorKind, 'multiverse'>, Draft[]> = {
		dwarf: [],
		star: [],
		core: [],
		cluster: [],
		home: []
	};

	/** An anchor of `kind` with room left, making one — and its own host — if need be. */
	function anchorFor(kind: Exclude<AnchorKind, 'multiverse'>): Draft {
		const open = anchors[kind].find((anchor) => anchor.loose < ANCHOR_CAPACITY);
		if (open) return open;

		const anchor = makeAnchor(kind, anchors[kind].length);
		anchors[kind].push(anchor);

		const parentKind = ANCHOR_PARENT[kind];
		const host = parentKind === 'multiverse' ? root : anchorFor(parentKind);
		host.children.push(anchor);
		if (parentKind !== 'multiverse') host.loose += 1;
		return anchor;
	}

	for (const snapshot of snapshots) {
		const node = nodes.get(snapshot.goal.id) as Draft;
		const parentId = snapshot.goal.parentId;
		const parent = parentId ? nodes.get(parentId) : undefined;
		if (parent) {
			parent.children.push(node);
			continue;
		}

		const anchorKind = ANCHOR_FOR[snapshot.goal.tier];
		if (anchorKind === 'multiverse') {
			root.children.push(node);
			continue;
		}
		const anchor = anchorFor(anchorKind);
		anchor.children.push(node);
		anchor.loose += 1;
	}

	// Asteroids alone summon the home star: nothing to circle otherwise. Only a
	// placeholder here — `layout()` needs to know the belt exists so it sizes
	// the star's lanes around it, but the rocks themselves need the belt's
	// inner edge and width, which `layout()` has not computed yet.
	if (asteroids.length > 0) {
		const home = anchors.star[0] ?? anchorFor('star');
		home.belt = { inner: 0, width: 0, rocks: [] };
	}

	layout(root);

	// Now that the belt's inner edge and width are settled, place every rock:
	// its radius is the inner edge plus however far it has drifted outward.
	const home = anchors.star[0];
	if (home?.belt) {
		const belt = home.belt;
		belt.rocks = sortBelt(asteroids)
			.slice(0, 30)
			.map((asteroid) => ({
				id: asteroid.id,
				angle: ((hash(asteroid.id) % 3600) / 3600) * Math.PI * 2,
				radius: belt.inner + driftFraction(asteroid, now) * belt.width,
				band: driftBand(asteroid, now)
			}));
	}

	return {
		root: toPublic(root),
		home: anchors.star[0] ? toPublic(anchors.star[0]) : null,
		galaxy: anchors.core[0] ? toPublic(anchors.core[0]) : null
	};
}
