import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
	PICK_RADIUS_PX,
	TAP_SLOP_PX,
	TapTracker,
	nearestOnScreen,
	projectToScreen,
	type Viewport
} from './pick';

/** A 390 × 600 view looking down -z from 10 units back, so the origin is dead centre. */
function view(): { camera: PerspectiveCamera; viewport: Viewport } {
	const camera = new PerspectiveCamera(50, 390 / 600, 0.01, 1000);
	camera.position.set(0, 0, 10);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld(true);
	return { camera, viewport: { width: 390, height: 600, tanHalfFov: Math.tan(Math.PI / 7.2) } };
}

/** The world point that lands `pixels` right of centre at depth zero. */
function rightOf(pixels: number, { camera, viewport }: ReturnType<typeof view>): Vector3 {
	const unitsPerPixel = (2 * 10 * Math.tan((camera.fov * Math.PI) / 360)) / viewport.height;
	return new Vector3(pixels * unitsPerPixel, 0, 0);
}

describe('projectToScreen', () => {
	it('puts the point the camera looks at in the middle of the view', () => {
		const { camera, viewport } = view();
		const point = projectToScreen(new Vector3(0, 0, 0), camera, viewport);
		expect(point.x).toBeCloseTo(195);
		expect(point.y).toBeCloseTo(300);
		expect(point.inFront).toBe(true);
	});

	it('says a point behind the camera is not in front of it', () => {
		const { camera, viewport } = view();
		expect(projectToScreen(new Vector3(0, 0, 20), camera, viewport).inFront).toBe(false);
	});
});

describe('nearestOnScreen', () => {
	it('picks the nearest candidate on screen, not the nearest in the scene', () => {
		const setup = view();
		const candidates = [
			{ value: 'far-on-screen', at: rightOf(20, setup) },
			// Much closer to the camera, and yet nearer the tap on screen.
			{ value: 'near-on-screen', at: rightOf(5, setup).multiplyScalar(0.5).setZ(5) }
		];
		expect(nearestOnScreen(candidates, setup.camera, setup.viewport, 195, 300)).toBe(
			'near-on-screen'
		);
	});

	it(`picks nothing further than ${PICK_RADIUS_PX}px from the tap`, () => {
		const setup = view();
		const candidates = [{ value: 'body', at: rightOf(PICK_RADIUS_PX + 2, setup) }];
		expect(nearestOnScreen(candidates, setup.camera, setup.viewport, 195, 300)).toBeNull();
		expect(nearestOnScreen(candidates, setup.camera, setup.viewport, 205, 300)).toBe('body');
	});

	it('never picks something behind the camera', () => {
		const setup = view();
		// Straight behind the eye projects to the middle of the view, mirrored.
		const candidates = [{ value: 'behind', at: new Vector3(0, 0, 20) }];
		expect(nearestOnScreen(candidates, setup.camera, setup.viewport, 195, 300)).toBeNull();
	});
});

describe('TapTracker', () => {
	it('is a tap when one finger goes down and comes up without moving', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 100, 100);
		expect(taps.onPointerUp(1, 100, 100)).toEqual({ x: 100, y: 100 });
	});

	it('is not a tap once a finger moves past the slop', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 100, 100);
		taps.onPointerMove(1, 100, 100 + TAP_SLOP_PX + 1);
		expect(taps.onPointerUp(1, 100, 100 + TAP_SLOP_PX + 1)).toBeNull();
	});

	it('moving back within the slop by the lift does not save a tap that strayed', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 100, 100);
		taps.onPointerMove(1, 100, 100 + TAP_SLOP_PX + 20);
		expect(taps.onPointerUp(1, 100, 100)).toBeNull();
	});

	it('voids the tap when a second pointer goes down, still finger down second and lifting first', () => {
		const taps = new TapTracker();
		// The moving finger goes down first.
		taps.onPointerDown(1, 100, 100);
		// The still finger goes down second — this used to measure zero and tap.
		taps.onPointerDown(2, 200, 200);
		expect(taps.onPointerUp(2, 200, 200)).toBeNull();
		expect(taps.onPointerUp(1, 140, 160)).toBeNull();
	});

	it('voids the tap the other way round too: still finger down first, moving finger second', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 200, 200);
		taps.onPointerDown(2, 100, 100);
		// The still finger (down first) lifts first.
		expect(taps.onPointerUp(1, 200, 200)).toBeNull();
		expect(taps.onPointerUp(2, 140, 160)).toBeNull();
	});

	it('a pointercancel voids the gesture, but the next clean tap still works', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 100, 100);
		taps.onPointerMove(1, 101, 100);
		taps.onPointerCancel(1);
		// Nothing left down, so the cancelled pointer leaves no tap to collect.
		taps.onPointerDown(2, 50, 50);
		expect(taps.onPointerUp(2, 50, 50)).toEqual({ x: 50, y: 50 });
	});

	it('a pointercancel on one finger of a pinch voids the other finger too', () => {
		const taps = new TapTracker();
		taps.onPointerDown(1, 100, 100);
		taps.onPointerDown(2, 200, 200);
		taps.onPointerCancel(1);
		expect(taps.onPointerUp(2, 200, 200)).toBeNull();
		// The gesture is over now; the next one starts clean.
		taps.onPointerDown(3, 10, 10);
		expect(taps.onPointerUp(3, 10, 10)).toEqual({ x: 10, y: 10 });
	});
});
