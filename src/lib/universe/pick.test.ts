import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PICK_RADIUS_PX, nearestOnScreen, projectToScreen, type Viewport } from './pick';

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
