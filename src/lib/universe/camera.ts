import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SceneNode } from './scene';

/**
 * The camera: controls, framing, fly-to and the zoom (#11, decision 7).
 *
 * Gestures are three's `OrbitControls` — one finger turns, a pinch zooms toward
 * the fingers, two fingers pan; wheel and right-drag on a desktop. The camera
 * never moves on its own: no idle rotation, no intro, no following a lapping
 * body. It moves when someone drags, pinches, scrubs the zoom, taps a body or
 * focuses a row, and nowhere else.
 */

export const FLIGHT_MS = 900;
export const MIN_DISTANCE = 0.8;
export const MAX_DISTANCE = 2_000_000;

export interface View {
	target: Vector3;
	eye: Vector3;
	distance: number;
	direction: Vector3;
}

interface Flight {
	fromTarget: Vector3;
	fromEye: Vector3;
	to: View;
	start: number;
}

/** Ease in and out, cubic — the fly-to's shape. */
function ease(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const worldQuaternion = new Quaternion();

export class CameraRig {
	readonly camera = new PerspectiveCamera(50, 1, 0.01, 1e8);
	readonly controls: OrbitControls;
	private flight: Flight | null = null;

	constructor(element: HTMLElement, animate: boolean) {
		this.controls = new OrbitControls(this.camera, element);
		this.controls.dampingFactor = 0.08;
		this.controls.screenSpacePanning = true;
		this.controls.minDistance = MIN_DISTANCE;
		this.controls.maxDistance = MAX_DISTANCE;
		this.controls.zoomToCursor = true;
		this.setMotion(animate);
	}

	/** Under reduced motion damping is off: a gesture stops where the finger does. */
	setMotion(animate: boolean): void {
		this.controls.enableDamping = animate;
	}

	get flying(): boolean {
		return this.flight !== null;
	}

	/** The view's vertical and horizontal fields, for fitting something across the narrower one. */
	private fit(): number {
		const vertical = MathUtils.degToRad(this.camera.fov);
		const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
		return Math.min(vertical, horizontal);
	}

	/**
	 * Where the camera goes to frame a node: the host's whole extent across the
	 * narrower side of the view — on a phone, the width, which is what runs out
	 * — looking down on its own plane at a slant so its orbits read as rings.
	 */
	viewFor(entry: SceneNode): View {
		const node = entry.node;
		const target = entry.holder.getWorldPosition(new Vector3());
		// A goal with nothing orbiting it is framed with its own orbit's
		// neighbourhood in view, so its trail comes with it.
		// A system is framed whole. A galaxy or universe is a region, so it is
		// framed by its extent even when nothing orbits in it. A lone world is
		// framed close: near enough to see it turn, with its own orbit — and so
		// its trail — running through the frame beside it.
		const region = node.kind === 'galaxy' || node.kind === 'universe';
		const reach =
			node.children.length > 0 || node.belt || region ? node.extent : node.bodyRadius * 3;
		const distance = Math.max((reach * 1.08) / Math.sin(this.fit() / 2), node.bodyRadius * 9);

		entry.plane.getWorldQuaternion(worldQuaternion);
		const normal = new Vector3(0, 1, 0).applyQuaternion(worldQuaternion);
		const side = new Vector3(0.35, 0, 0.9).applyQuaternion(worldQuaternion);
		const direction = normal.multiplyScalar(0.82).add(side.multiplyScalar(0.55)).normalize();
		const eye = target.clone().addScaledVector(direction, distance);
		return { target, eye, distance, direction };
	}

	/** Go to a view: a 900ms ease when motion is allowed, an instant cut when it is not. */
	go(view: View, instant: boolean, now: number): void {
		if (instant) {
			this.flight = null;
			this.jump(view);
			return;
		}
		this.flight = {
			fromTarget: this.controls.target.clone(),
			fromEye: this.camera.position.clone(),
			to: view,
			start: now
		};
	}

	jump(view: View): void {
		this.controls.target.copy(view.target);
		this.camera.position.copy(view.eye);
		this.controls.update();
	}

	/**
	 * Carry the camera — eye, target and any flight in progress — along by
	 * `delta`, so a body it is looking at stays where it is in the frame.
	 */
	shift(delta: Vector3): void {
		this.controls.target.add(delta);
		this.camera.position.add(delta);
		if (this.flight) {
			this.flight.to.target.add(delta);
			this.flight.to.eye.add(delta);
		}
	}

	cancelFlight(): void {
		this.flight = null;
	}

	/** Advance a flight in progress. True while there is more of it to fly. */
	step(now: number): boolean {
		if (!this.flight) return false;
		const t = Math.min(1, (now - this.flight.start) / FLIGHT_MS);
		const k = ease(t);
		this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.to.target, k);
		this.camera.position.lerpVectors(this.flight.fromEye, this.flight.to.eye, k);
		if (t >= 1) this.flight = null;
		return this.flight !== null;
	}

	resize(width: number, height: number): void {
		this.camera.aspect = width / Math.max(height, 1);
		this.camera.updateProjectionMatrix();
	}

	/**
	 * The zoom's view at `value`, 0 at the first stop and 1 at the last, with
	 * the stops spread evenly between: the target slides along the chain of stops,
	 * and the distance moves on a log scale, so every notch is the same factor
	 * of zoom among satellites as among universes. Powers of ten, not a menu.
	 */
	viewAt(stops: readonly SceneNode[], value: number): View {
		const views = stops.map((stop) => this.viewFor(stop));
		if (views.length === 1) return views[0];
		const x = value * (views.length - 1);
		const index = Math.min(views.length - 2, Math.max(0, Math.floor(x)));
		const t = x - index;
		const a = views[index];
		const b = views[index + 1];
		const target = a.target.clone().lerp(b.target, t);
		const distance = Math.exp(Math.log(a.distance) * (1 - t) + Math.log(b.distance) * t);
		const direction = a.direction.clone().lerp(b.direction, t).normalize();
		return {
			target,
			eye: target.clone().addScaledVector(direction, distance),
			distance,
			direction
		};
	}

	/** Where the zoom sits, 0–1, for the camera's current distance, so a pinch moves it too. */
	zoomValue(stops: readonly SceneNode[]): number {
		if (stops.length < 2) return 0;
		const distances = stops.map((stop) => this.viewFor(stop).distance);
		const distance = this.camera.position.distanceTo(this.controls.target);
		if (distance <= distances[0]) return 0;
		if (distance >= distances[distances.length - 1]) return 1;
		for (let index = 0; index < distances.length - 1; index += 1) {
			// Two stops framed from the same distance leave no room to scrub
			// between them; the next pair does.
			if (distances[index + 1] <= distances[index]) continue;
			if (distance <= distances[index + 1]) {
				const t =
					Math.log(distance / distances[index]) / Math.log(distances[index + 1] / distances[index]);
				return (index + t) / (distances.length - 1);
			}
		}
		return 1;
	}

	dispose(): void {
		this.controls.dispose();
	}
}
