import { describe, expect, it } from 'vitest';
import type { UniverseNode, UniverseTree } from '$domain/universe';
import { type Box, type LabelCandidate, declutterLabels, shapeKey } from './scene';

/** A minimal node — only the fields `shapeKey` and the tests here care about are ever varied. */
function node(overrides: Partial<UniverseNode> = {}): UniverseNode {
	return {
		id: 'g1',
		kind: 'satellite',
		goalId: 'g1',
		bodyRadius: 0.28,
		extent: 0.28,
		orbitRadius: 1,
		angle: 0,
		fraction: 0.5,
		closed: false,
		dormant: false,
		lapSeconds: 16,
		variant: 0,
		tilt: 0,
		spin: 0,
		children: [],
		belt: null,
		...overrides
	};
}

function tree(root: UniverseNode): UniverseTree {
	return { root, home: null, galaxy: null, universe: null };
}

/** A small tree: a dwarf anchor with one satellite goal and one planet goal. */
function baseTree(
	overrides: { satellite?: Partial<UniverseNode>; planet?: Partial<UniverseNode> } = {}
) {
	return tree(
		node({
			id: 'dwarf-0',
			kind: 'dwarf',
			goalId: null,
			children: [
				node({ id: 'g1', kind: 'satellite', goalId: 'g1', variant: 1, ...overrides.satellite }),
				node({ id: 'g2', kind: 'planet', goalId: 'g2', variant: 2, ...overrides.planet })
			]
		})
	);
}

describe('shapeKey', () => {
	it('keeps the key across a log: a fraction change alone', () => {
		const before = baseTree();
		const after = baseTree({ satellite: { fraction: 0.5 }, planet: { fraction: 0.9 } });
		expect(shapeKey(after)).toBe(shapeKey(before));
	});

	it('keeps the key across a closing: the closed flag flipping on', () => {
		const before = baseTree({ satellite: { fraction: 0.9, closed: false } });
		const after = baseTree({ satellite: { fraction: 1, closed: true } });
		expect(shapeKey(after)).toBe(shapeKey(before));
	});

	it('keeps the key across a percentage change', () => {
		const before = baseTree({ planet: { fraction: 0.1 } });
		const after = baseTree({ planet: { fraction: 0.73 } });
		expect(shapeKey(after)).toBe(shapeKey(before));
	});

	it('changes the key when a goal is added', () => {
		const before = baseTree();
		const after = tree(
			node({
				id: 'dwarf-0',
				kind: 'dwarf',
				goalId: null,
				children: [
					node({ id: 'g1', kind: 'satellite', goalId: 'g1', variant: 1 }),
					node({ id: 'g2', kind: 'planet', goalId: 'g2', variant: 2 }),
					node({ id: 'g3', kind: 'satellite', goalId: 'g3', variant: 0 })
				]
			})
		);
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});

	it('changes the key when a goal is archived (removed from the tree)', () => {
		const before = baseTree();
		const after = tree(
			node({
				id: 'dwarf-0',
				kind: 'dwarf',
				goalId: null,
				children: [node({ id: 'g1', kind: 'satellite', goalId: 'g1', variant: 1 })]
			})
		);
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});

	it('changes the key when a goal is re-parented', () => {
		const before = tree(
			node({
				id: 'dwarf-0',
				kind: 'dwarf',
				goalId: null,
				children: [
					node({
						id: 'g1',
						kind: 'satellite',
						goalId: 'g1',
						variant: 1,
						children: [node({ id: 'g2', kind: 'satellite', goalId: 'g2', variant: 0 })]
					})
				]
			})
		);
		// g2 moves from under g1 to be g1's sibling instead — same node set, a
		// different parent for one of them.
		const after = tree(
			node({
				id: 'dwarf-0',
				kind: 'dwarf',
				goalId: null,
				children: [
					node({ id: 'g1', kind: 'satellite', goalId: 'g1', variant: 1 }),
					node({ id: 'g2', kind: 'satellite', goalId: 'g2', variant: 0 })
				]
			})
		);
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});

	it('changes the key when a goal moves to another tier', () => {
		const before = baseTree();
		const after = baseTree({ satellite: { kind: 'planet', bodyRadius: 0.9 } });
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});

	it('changes the key when an asteroid is captured onto the belt', () => {
		const before = tree(
			node({ id: 'star-0', kind: 'star', goalId: null, belt: { inner: 1, width: 1, rocks: [] } })
		);
		const after = tree(
			node({
				id: 'star-0',
				kind: 'star',
				goalId: null,
				belt: {
					inner: 1,
					width: 1,
					rocks: [{ id: 'rock-1', angle: 0, radius: 1, band: 'fresh' }]
				}
			})
		);
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});

	it('changes the key when a node becomes dormant', () => {
		const before = baseTree({ satellite: { dormant: false } });
		const after = baseTree({ satellite: { dormant: true } });
		expect(shapeKey(after)).not.toBe(shapeKey(before));
	});
});

/** A box `width` × `height`, at `(x, y)` top-left. */
function box(x: number, y: number, width = 80, height = 24): Box {
	return { left: x, right: x + width, top: y, bottom: y + height };
}

function candidate(id: string, b: Box, size: number, distance = 1): LabelCandidate {
	return { id, box: b, size, distance };
}

describe('declutterLabels', () => {
	it('keeps a label shown last frame when a candidate is only slightly larger', () => {
		const shownLastFrame = new Set(['a']);
		const a = candidate('a', box(0, 0), 1);
		// Overlaps a's box, and is larger — but less than 1.5x.
		const b = candidate('b', box(10, 10), 1.2);
		const shown = declutterLabels([a, b], [], shownLastFrame, 12);
		expect(shown).toEqual(new Set(['a']));
	});

	it('yields a label shown last frame to one 1.5x larger that overlaps it', () => {
		const shownLastFrame = new Set(['a']);
		const a = candidate('a', box(0, 0), 1);
		const b = candidate('b', box(10, 10), 1.5);
		const shown = declutterLabels([a, b], [], shownLastFrame, 12);
		expect(shown).toEqual(new Set(['b']));
	});

	it('leaves a label shown last frame when it is no longer a candidate', () => {
		// "a" was shown last frame, but no longer fits — the caller simply does
		// not pass it as a candidate this frame.
		const shownLastFrame = new Set(['a']);
		const b = candidate('b', box(200, 200), 1);
		const shown = declutterLabels([b], [], shownLastFrame, 12);
		expect(shown).toEqual(new Set(['b']));
		expect(shown.has('a')).toBe(false);
	});

	it('never shows more than the cap', () => {
		const candidates = Array.from({ length: 14 }, (_, i) =>
			// Spaced well apart, so nothing overlaps and only the cap limits them.
			candidate(`c${i}`, box(i * 200, 0), 1, i)
		);
		const shown = declutterLabels(candidates, [], new Set(), 12);
		expect(shown.size).toBe(12);
	});

	it('never displaces a box to avoid, however large the candidate', () => {
		const avoided = box(0, 0);
		const candidates = [candidate('a', box(10, 10), 100)];
		const shown = declutterLabels(candidates, [avoided], new Set(), 12);
		expect(shown.size).toBe(0);
	});

	it('shows a fresh candidate outright when nothing overlaps it', () => {
		const shown = declutterLabels([candidate('a', box(0, 0), 1)], [], new Set(), 12);
		expect(shown).toEqual(new Set(['a']));
	});
});
