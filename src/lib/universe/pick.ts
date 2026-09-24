import { Vector3, type PerspectiveCamera } from 'three';

/**
 * What a tap lands on: the nearest candidate on screen, not a ray cast.
 *
 * Most bodies are a few pixels across at most zooms, and a ray has to hit
 * them exactly; a finger does not. So a tap takes whichever goal body or rock
 * projects nearest to it, within 24px (#11, decision 8). Anchors are never
 * offered as candidates — that is the caller's list to make, not this file's.
 */

/** The view's size in CSS pixels, and the camera's vertical half-angle, for pixel maths. */
export interface Viewport {
	width: number;
	height: number;
	/** `tan(fov / 2)`, which turns a pixel size into a view-space one. */
	tanHalfFov: number;
}

export interface ScreenPoint {
	x: number;
	y: number;
	/** False when the point is behind the camera or past its far plane. */
	inFront: boolean;
}

/** A tap is a pointer that went down and came up within this many pixels. */
export const TAP_SLOP_PX = 6;
/** How far from a body a tap can land and still pick it. */
export const PICK_RADIUS_PX = 24;

const scratch = new Vector3();

/** Where a world-space point lands in the view, in CSS pixels from its top left. */
export function projectToScreen(
	point: Vector3,
	camera: PerspectiveCamera,
	viewport: Viewport
): ScreenPoint {
	scratch.copy(point).project(camera);
	return {
		x: ((scratch.x + 1) / 2) * viewport.width,
		y: ((1 - scratch.y) / 2) * viewport.height,
		inFront: scratch.z >= -1 && scratch.z <= 1
	};
}

export interface Candidate<T> {
	value: T;
	at: Vector3;
}

/** The candidate nearest `(x, y)` on screen within `radius` pixels, or null. */
export function nearestOnScreen<T>(
	candidates: Iterable<Candidate<T>>,
	camera: PerspectiveCamera,
	viewport: Viewport,
	x: number,
	y: number,
	radius = PICK_RADIUS_PX
): T | null {
	let best: T | null = null;
	let bestDistance = radius;
	for (const candidate of candidates) {
		const point = projectToScreen(candidate.at, camera, viewport);
		if (!point.inFront) continue;
		const distance = Math.hypot(point.x - x, point.y - y);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = candidate.value;
		}
	}
	return best;
}
