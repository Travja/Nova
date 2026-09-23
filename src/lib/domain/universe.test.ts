import { describe, expect, it } from 'vitest';
import { bodyVariant } from './bodies';
import { buildOrbit, type GoalSnapshot } from './progress';
import type { Goal } from './types';
import type { Tier } from './tiers';
import { MIN_EXTENT, UNIVERSE_LAP_SECONDS, universeTree, type UniverseNode } from './universe';

const NOW = new Date('2026-06-15T12:00:00Z');
const PERIOD = {
	start: new Date('2026-06-15T00:00:00Z'),
	end: new Date('2026-06-16T00:00:00Z'),
	key: 'day:2026-06-15',
	cadence: 'day' as const
};

/** A minimal goal snapshot: target is always 1, so `fraction` is the amount logged. */
function goal(
	id: string,
	tier: Tier,
	options: {
		parentId?: string | null;
		sortOrder?: number;
		fraction?: number;
		closed?: boolean;
		dormant?: boolean;
	} = {}
): GoalSnapshot {
	const fraction = options.closed ? 1 : (options.fraction ?? 0);
	const current = buildOrbit(PERIOD, fraction, 1, options.dormant ?? false);
	const goalRow: Goal = {
		id,
		userId: 'pilot',
		title: id,
		description: null,
		tier,
		metric: { kind: 'count', unit: '' },
		target: 1,
		color: '#a78bfa',
		sortOrder: options.sortOrder ?? 0,
		createdAt: new Date('2025-01-01T00:00:00Z'),
		archivedAt: null,
		parentId: options.parentId ?? null
	};
	return {
		goal: goalRow,
		current,
		history: [current],
		streak: 0,
		totalOrbits: 0,
		lifetimeLogged: fraction
	};
}

function rock(id: string, ageDays: number) {
	return { id, driftAnchorAt: new Date(NOW.getTime() - ageDays * 24 * 60 * 60 * 1000) };
}

/** Every node in the tree, root included. */
function walk(node: UniverseNode): UniverseNode[] {
	return [node, ...node.children.flatMap(walk)];
}

function find(node: UniverseNode, kind: UniverseNode['kind']): UniverseNode[] {
	return walk(node).filter((candidate) => candidate.kind === kind);
}

describe('universeTree', () => {
	it('brings the whole home chain for a loose satellite, and nothing else', () => {
		const { root } = universeTree([goal('sat', 'satellite')], [], NOW);

		expect(root.children).toHaveLength(1);
		const home = root.children[0];
		expect(home.kind).toBe('home');
		expect(home.children).toHaveLength(1);
		const cluster = home.children[0];
		expect(cluster.kind).toBe('cluster');
		expect(cluster.children).toHaveLength(1);
		const core = cluster.children[0];
		expect(core.kind).toBe('core');
		expect(core.children).toHaveLength(1);
		const star = core.children[0];
		expect(star.kind).toBe('star');
		expect(star.children).toHaveLength(1);
		const dwarf = star.children[0];
		expect(dwarf.kind).toBe('dwarf');
		expect(dwarf.children).toHaveLength(1);
		expect(dwarf.children[0].goalId).toBe('sat');

		// The whole tree is exactly this chain: root, home, cluster, core, star,
		// dwarf, the satellite — nothing else came along for the ride.
		expect(walk(root)).toHaveLength(7);
	});

	it('sizes an empty Galaxy goal the same as the home galaxy', () => {
		const { root } = universeTree(
			[
				goal('empty-galaxy', 'galaxy'),
				goal('star-system-1', 'starSystem'),
				goal('star-system-2', 'starSystem', { sortOrder: 1 })
			],
			[],
			NOW
		);

		const galaxyGoal = find(root, 'galaxy')[0];
		const homeGalaxy = find(root, 'core')[0];
		expect(galaxyGoal.extent).toBe(MIN_EXTENT.galaxy);
		expect(homeGalaxy.extent).toBe(MIN_EXTENT.galaxy);
	});

	it("gives a universe an extent at least ten galaxies' across", () => {
		const { root } = universeTree([goal('universe-goal', 'universe')], [], NOW);
		const universeGoal = find(root, 'universe')[0];
		expect(universeGoal.extent).toBeGreaterThanOrEqual(10 * MIN_EXTENT.galaxy);
	});

	it('orbits loose Universe goals and the home universe round the barycentre', () => {
		const { root } = universeTree(
			[goal('year-goal', 'universe'), goal('sat', 'satellite')],
			[],
			NOW
		);

		expect(root.kind).toBe('multiverse');
		const kinds = root.children.map((child) => child.kind).sort();
		expect(kinds).toEqual(['home', 'universe']);
	});

	it('gives a Star-System-only account no dwarf and no star', () => {
		const { root } = universeTree([goal('monthly-push', 'starSystem')], [], NOW);
		expect(find(root, 'dwarf')).toHaveLength(0);
		expect(find(root, 'star')).toHaveLength(0);
		// It still gets a core, a cluster and a home universe: what a loose Star
		// System actually orbits, all the way up to the barycentre.
		expect(find(root, 'core')).toHaveLength(1);
	});

	it('opens a second anchor for a seventh loose goal', () => {
		const satellites = Array.from({ length: 7 }, (_, index) =>
			goal(`sat-${index}`, 'satellite', { sortOrder: index })
		);
		const { root } = universeTree(satellites, [], NOW);

		const dwarves = find(root, 'dwarf');
		expect(dwarves).toHaveLength(2);
		expect(dwarves[0].children).toHaveLength(6);
		expect(dwarves[1].children).toHaveLength(1);
	});

	it('never splits a real parent, however many children it has', () => {
		const children = Array.from({ length: 7 }, (_, index) =>
			goal(`sat-${index}`, 'satellite', { parentId: 'planet', sortOrder: index })
		);
		const { root } = universeTree([goal('planet', 'planet'), ...children], [], NOW);

		const planet = find(root, 'planet')[0];
		expect(planet.children).toHaveLength(7);
	});

	it('orbits a child on its parent at any depth', () => {
		const { root } = universeTree(
			[
				goal('year', 'universe'),
				goal('quarter', 'galaxy', { parentId: 'year' }),
				goal('month', 'starSystem', { parentId: 'quarter' }),
				goal('week', 'planet', { parentId: 'month' }),
				goal('day', 'satellite', { parentId: 'week' })
			],
			[],
			NOW
		);

		const year = find(root, 'universe')[0];
		const quarter = year.children[0];
		expect(quarter.goalId).toBe('quarter');
		const month = quarter.children[0];
		expect(month.goalId).toBe('month');
		const week = month.children[0];
		expect(week.goalId).toBe('week');
		const day = week.children[0];
		expect(day.goalId).toBe('day');
	});

	it('orbits a rung-skipping child directly on its parent, drawn as its own tier', () => {
		const { root } = universeTree(
			[goal('month', 'starSystem'), goal('day', 'satellite', { parentId: 'month' })],
			[],
			NOW
		);

		const month = find(root, 'starSystem')[0];
		expect(month.children).toHaveLength(1);
		expect(month.children[0]).toMatchObject({ kind: 'satellite', goalId: 'day' });
	});

	it('gives two goals at the same progress the same angle but different radii', () => {
		const { root } = universeTree(
			[
				goal('a', 'satellite', { fraction: 0.5, sortOrder: 0 }),
				goal('b', 'satellite', { fraction: 0.5, sortOrder: 1 })
			],
			[],
			NOW
		);

		const dwarf = find(root, 'dwarf')[0];
		const [a, b] = dwarf.children;
		expect(a.angle).toBeCloseTo(b.angle);
		expect(a.orbitRadius).not.toBeCloseTo(b.orbitRadius);
	});

	it('never lets siblings overlap at any angle', () => {
		// A planet with satellite children of its own sits beside two plain
		// satellites — a deliberately uneven set of extents under one host.
		const { root } = universeTree(
			[
				goal('planet', 'planet', { sortOrder: 0 }),
				goal('planet-child-1', 'satellite', { parentId: 'planet', sortOrder: 0 }),
				goal('planet-child-2', 'satellite', { parentId: 'planet', sortOrder: 1 }),
				goal('lone-a', 'satellite', { sortOrder: 1 }),
				goal('lone-b', 'satellite', { sortOrder: 2 })
			],
			[],
			NOW
		);

		const star = find(root, 'star')[0];
		const siblings = star.children;
		expect(siblings.length).toBeGreaterThan(1);
		for (let i = 0; i < siblings.length; i += 1) {
			for (let j = i + 1; j < siblings.length; j += 1) {
				const a = siblings[i];
				const b = siblings[j];
				expect(Math.abs(a.orbitRadius - b.orbitRadius)).toBeGreaterThanOrEqual(a.extent + b.extent);
			}
		}
	});

	it('sets angle from progress and gives a closed goal the whole ring as its trail', () => {
		const { root } = universeTree(
			[
				goal('open', 'satellite', { fraction: 0.37, sortOrder: 0 }),
				goal('closed', 'satellite', { closed: true, sortOrder: 1 })
			],
			[],
			NOW
		);

		const dwarf = find(root, 'dwarf')[0];
		const open = dwarf.children.find((node) => node.goalId === 'open')!;
		const closed = dwarf.children.find((node) => node.goalId === 'closed')!;

		expect(open.angle).toBeCloseTo(0.37 * Math.PI * 2);
		expect(open.fraction).toBeCloseTo(0.37);
		expect(open.closed).toBe(false);

		expect(closed.fraction).toBe(1);
		expect(closed.closed).toBe(true);
		expect(closed.angle).toBeCloseTo(Math.PI * 2);
	});

	it('never gives an anchor a goal id, and never leaves a goal without one', () => {
		const { root } = universeTree(
			[goal('sat', 'satellite'), goal('year', 'universe')],
			[{ id: 'rock-1', driftAnchorAt: NOW }],
			NOW
		);

		for (const node of walk(root)) {
			if (node.goalId === null) {
				expect(['dwarf', 'star', 'core', 'cluster', 'home', 'multiverse']).toContain(node.kind);
			} else {
				expect(['satellite', 'planet', 'starSystem', 'galaxy', 'universe']).toContain(node.kind);
			}
		}
	});

	it('summons the home star from asteroids alone', () => {
		const { root, home } = universeTree([], [rock('a', 1)], NOW);

		expect(home).not.toBeNull();
		expect(home?.kind).toBe('star');
		expect(home?.belt).not.toBeNull();
		// Nothing else is in the tree: no loose goal ever entered it.
		expect(find(root, 'satellite')).toHaveLength(0);
		expect(find(root, 'planet')).toHaveLength(0);
	});

	it("rises a rock's radius with drift and stops it at the belt's edge", () => {
		const { home } = universeTree(
			[],
			[rock('fresh', 0), rock('mid', 10), rock('old', 30), rock('ancient', 400)],
			NOW
		);

		const belt = home!.belt!;
		const byId = new Map(belt.rocks.map((r) => [r.id, r]));
		const fresh = byId.get('fresh')!;
		const mid = byId.get('mid')!;
		const old = byId.get('old')!;
		const ancient = byId.get('ancient')!;

		expect(fresh.radius).toBeCloseTo(belt.inner);
		expect(mid.radius).toBeGreaterThan(fresh.radius);
		expect(old.radius).toBeGreaterThan(mid.radius);
		// Past the release offer, drift is clamped: a year-old rock sits exactly
		// where a month-old one does, at the belt's outer edge.
		expect(old.radius).toBeCloseTo(belt.inner + belt.width);
		expect(ancient.radius).toBeCloseTo(old.radius);
	});

	it("carries each goal's lap from its tier, and gives anchors none", () => {
		const { root } = universeTree(
			[
				goal('sat', 'satellite', { closed: true }),
				goal('week', 'planet'),
				goal('year', 'universe', { closed: true })
			],
			[],
			NOW
		);

		for (const node of walk(root)) {
			if (node.goalId === null) expect(node.lapSeconds).toBe(0);
		}
		const byId = new Map(walk(root).map((node) => [node.id, node]));
		expect(byId.get('sat')!.lapSeconds).toBe(UNIVERSE_LAP_SECONDS.satellite);
		expect(byId.get('week')!.lapSeconds).toBe(UNIVERSE_LAP_SECONDS.planet);
		expect(byId.get('year')!.lapSeconds).toBe(UNIVERSE_LAP_SECONDS.universe);
	});

	it("carries each goal's body variant as its dial picks it, and gives anchors 0", () => {
		const snapshots = [
			goal('sat-a', 'satellite'),
			goal('sat-b', 'satellite', { sortOrder: 1 }),
			goal('world', 'planet'),
			goal('year', 'universe')
		];
		const { root } = universeTree(snapshots, [], NOW);

		for (const node of walk(root)) {
			if (node.goalId === null) expect(node.variant).toBe(0);
			else if (node.kind !== 'dwarf') {
				const tier = snapshots.find((snapshot) => snapshot.goal.id === node.goalId)!.goal.tier;
				expect(node.variant).toBe(bodyVariant(tier, node.goalId));
			}
		}
	});

	it('names the zoom stops on the home chain, and only the ones that exist', () => {
		const full = universeTree([goal('sat', 'satellite')], [], NOW);
		expect(full.home?.id).toBe('star-0');
		expect(full.galaxy?.id).toBe('core-0');
		expect(full.universe?.id).toBe('home-0');
		expect(full.root.children.map((node) => node.id)).toContain('home-0');

		// Universe goals alone orbit the barycentre directly: no home chain at all.
		const bare = universeTree([goal('year', 'universe')], [], NOW);
		expect(bare.home).toBeNull();
		expect(bare.galaxy).toBeNull();
		expect(bare.universe).toBeNull();
	});

	it('builds the identical tree from the same input twice', () => {
		const snapshots = [
			goal('year', 'universe'),
			goal('quarter', 'galaxy', { parentId: 'year' }),
			goal('loose-satellite', 'satellite', { fraction: 0.6 }),
			goal('another-satellite', 'satellite', { fraction: 0.6, sortOrder: 1, closed: true })
		];
		const asteroids = [rock('a', 2), rock('b', 25)];

		const first = universeTree(snapshots, asteroids, NOW);
		const second = universeTree(snapshots, asteroids, NOW);

		expect(second).toEqual(first);
	});
});
