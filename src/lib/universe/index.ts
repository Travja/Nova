import {
	AdditiveBlending,
	Color,
	Group,
	Quaternion,
	Sprite,
	SpriteMaterial,
	Vector3,
	WebGLRenderer,
	type Texture
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { SWEEP_MS } from '$domain/celebration';
import type { UniverseTree } from '$domain/universe';
import { motionAllowed, onMotionChange } from '$lib/motion';
import { BodyArt } from './art';
import { CameraRig } from './camera';
import { createLoop } from './loop';
import { TAP_SLOP_PX, nearestOnScreen, projectToScreen, type Viewport } from './pick';
import {
	LINE,
	buildScene,
	drawn,
	glowTexture,
	levelOfDetail,
	setShown,
	type Box,
	type SceneGoal,
	type SceneNode,
	type UniverseScene
} from './scene';

/**
 * The universe view's renderer (#11) — the only place in the app that imports
 * three, and only ever through a dynamic `import()` from
 * `$components/Universe.svelte`'s `onMount`, so nothing three-shaped runs on
 * the server and the tiers view never downloads it.
 *
 * It draws what `$domain/universe` decided and holds no progress maths of its
 * own; the component hands it the tree, the words and colours the tree does
 * not carry, and the zoom's stops, and hears back what was tapped and where the
 * zoom is.
 */

export type { SceneGoal } from './scene';

export interface ZoomStop {
	/** The node the stop frames, by its tree id. */
	id: string;
	label: string;
}

export interface UniverseInput {
	tree: UniverseTree;
	goals: Readonly<Record<string, SceneGoal>>;
	stops: readonly ZoomStop[];
}

export type Picked = { kind: 'goal'; goalId: string } | { kind: 'rock'; id: string };

/** A closing to light, from `celebrationFor()`: how many rays and for how long. */
export interface Closing {
	goalId: string;
	rays: number;
	ms: number;
	stamp: number;
}

export type RendererState = 'ready' | 'lost';

export interface MountOptions {
	/** Where the zoom starts: 0 is the first stop, 1 the last. */
	zoom: number;
	onpick(picked: Picked | null): void;
	/** Where the zoom now sits, 0–1, after a gesture or a flight moved the camera. */
	onzoom(value: number): void;
	onstate(state: RendererState): void;
	/** The hidden SVG of the dial body a `SceneGoal.art` key names, drawn by the page. */
	art?: (key: string) => SVGSVGElement | null;
	/** Elements over the view that labels must not be drawn across, such as the zoom. */
	avoid?: () => readonly Element[];
}

export interface UniverseView {
	update(input: UniverseInput): void;
	flyTo(goalId: string): void;
	zoomTo(value: number): void;
	celebrate(closing: Closing | null): void;
	/** True while the sheet is over the view, when a closing is the sheet's to show. */
	setCovered(covered: boolean): void;
	destroy(): void;
}

/** The dev-only handle on `window.__novaUniverse`; see the bottom of `mountUniverse`. */
export interface UniverseProbe {
	/** Where a goal body or rock is on the page, in CSS pixels, or null when it is not drawn. */
	where(id: string): { x: number; y: number } | null;
	/** Every rock on the belt, by asteroid id. */
	rocks(): string[];
	/** Frames drawn since mount. */
	frames(): number;
	/** No flight and no closing in progress. */
	settled(): boolean;
}

/** How far a closing's rays reach, in the body's own radii (decision 12). */
const BURST_REACH = 6;
/** The white flash at a closing body, a glow held at this radius in pixels. */
const FLASH_PX = 90;

function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Draw the universe into `host`. Throws when WebGL is unavailable — the
 * component catches that and says so, and the list below does the work.
 */
export function mountUniverse(
	host: HTMLElement,
	initial: UniverseInput,
	options: MountOptions
): UniverseView {
	const renderer = new WebGLRenderer({
		antialias: true,
		alpha: true,
		logarithmicDepthBuffer: true
	});
	const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
	renderer.setPixelRatio(pixelRatio);
	renderer.setClearColor(0x000000, 0);
	const canvas = renderer.domElement;
	canvas.setAttribute('aria-hidden', 'true');
	canvas.classList.add('universe-canvas');
	host.prepend(canvas);

	const labels = new CSS2DRenderer();
	labels.domElement.classList.add('universe-labels');
	labels.domElement.setAttribute('aria-hidden', 'true');
	host.append(labels.domElement);

	let animate = motionAllowed();
	const rig = new CameraRig(canvas, animate);
	const glow: Texture = glowTexture();
	// The dial's bodies, drawn from the page's hidden SVGs; each asks for a frame
	// once its pixels are in, since nothing else would.
	const art = new BodyArt(options.art ?? (() => null), () => loop.request());

	let input = initial;
	let viewport: Viewport = { width: 1, height: 1, tanHalfFov: Math.tan(Math.PI / 7.2) };
	// Assigned by the first `build()`, below, before anything reads it.
	let universe!: UniverseScene;
	let stops: SceneNode[] = [];
	let closing: (Closing & { start: number }) | null = null;
	let covered = false;
	let scrubbing = false;

	function measure(): Viewport {
		const width = Math.max(1, host.clientWidth);
		const height = Math.max(1, host.clientHeight);
		const tanHalfFov = Math.tan((rig.camera.fov * Math.PI) / 360);
		return { width, height, tanHalfFov };
	}

	/** Build (or rebuild) the scene from `input`, carrying each trail's last reading so a log sweeps. */
	function build(sweep: boolean) {
		const previous = new Map<string, { shown: number; lapStart: number | null }>();
		if (universe !== undefined) {
			for (const [goalId, entry] of universe.byGoal) {
				previous.set(goalId, { shown: entry.shown, lapStart: entry.lapStart });
			}
			universe.dispose();
		}
		universe = buildScene(input.tree, input.goals, {
			glow,
			art,
			pixelRatio,
			viewport,
			labelLayer: labels.domElement,
			previous,
			now: performance.now(),
			animate: sweep && animate
		});
		universe.scene.updateMatrixWorld(true);
		stops = input.stops
			.map((stop) => universe.byId.get(stop.id))
			.filter((entry): entry is SceneNode => entry !== undefined);
		if (closing) attachBurst(closing);
	}

	function resize() {
		viewport = measure();
		renderer.setSize(viewport.width, viewport.height);
		labels.setSize(viewport.width, viewport.height);
		rig.resize(viewport.width, viewport.height);
		universe.resize(viewport);
		loop.request();
	}

	function avoidBoxes(): Box[] {
		const elements = options.avoid?.() ?? [];
		if (elements.length === 0) return [];
		const origin = canvas.getBoundingClientRect();
		return elements.map((element) => {
			const rect = element.getBoundingClientRect();
			return {
				left: rect.left - origin.left,
				right: rect.right - origin.left,
				top: rect.top - origin.top,
				bottom: rect.bottom - origin.top
			};
		});
	}

	function syncZoom() {
		options.onzoom(rig.zoomValue(stops));
	}

	/* ------------------------------------------------------------------ *
	 * The closing: the ring lit twice as wide, and — when motion is
	 * allowed — rays and a flash at the body, billboarded to the camera.
	 * ------------------------------------------------------------------ */

	function attachBurst(current: Closing) {
		const entry = universe.byGoal.get(current.goalId);
		if (!entry || !entry.trailMaterial || !entry.goal) return;
		entry.trailMaterial.linewidth = LINE.closed * 2;
		entry.trailMaterial.color.set(new Color(entry.goal.color).lerp(new Color('#ffffff'), 0.35));
		if (!animate) return;

		const burst = new Group();
		const color = new Color(entry.goal.color);
		const inner = entry.node.bodyRadius * 1.6;
		const reach = entry.node.bodyRadius * BURST_REACH;
		for (let index = 0; index < current.rays; index += 1) {
			const angle = (index / current.rays) * Math.PI * 2;
			const geometry = new LineGeometry();
			geometry.setPositions([
				Math.cos(angle) * inner,
				Math.sin(angle) * inner,
				0,
				Math.cos(angle) * reach,
				Math.sin(angle) * reach,
				0
			]);
			const material = new LineMaterial({
				color: color.getHex(),
				linewidth: LINE.ray,
				transparent: true,
				opacity: 0.9,
				depthWrite: false
			});
			material.resolution.set(viewport.width, viewport.height);
			burst.add(new Line2(geometry, material));
		}
		const flash = new Sprite(
			new SpriteMaterial({
				map: glow,
				color: 0xffffff,
				transparent: true,
				opacity: 0.9,
				depthWrite: false,
				blending: AdditiveBlending,
				sizeAttenuation: false
			})
		);
		const k = (4 * FLASH_PX * viewport.tanHalfFov) / viewport.height;
		flash.scale.set(k, k, 1);
		flash.userData.flash = true;
		burst.add(flash);
		entry.holder.add(burst);
		entry.burst = burst;
	}

	function detachBurst(goalId: string) {
		const entry = universe.byGoal.get(goalId);
		if (!entry) return;
		if (entry.trailMaterial && entry.goal) {
			entry.trailMaterial.linewidth = entry.node.closed ? LINE.closed : LINE.trail;
			entry.trailMaterial.color.set(entry.goal.color);
		}
		if (entry.burst) {
			for (const child of entry.burst.children) {
				// A sprite's geometry is one three shares between every sprite.
				if (child instanceof Line2) child.geometry.dispose();
				(child as Line2 | Sprite).material.dispose();
			}
			entry.burst.removeFromParent();
			entry.burst = null;
		}
	}

	const parentQuaternion = new Quaternion();

	/** Advance the closing. True while there is more of it. */
	function stepClosing(time: number): boolean {
		if (!closing) return false;
		const t = (time - closing.start) / closing.ms;
		const entry = universe.byGoal.get(closing.goalId);
		if (t >= 1 || !entry) {
			detachBurst(closing.goalId);
			closing = null;
			return false;
		}
		// The sheet is over the view: the closing is the sheet's to show.
		if (entry.burst) entry.burst.visible = !covered;
		if (entry.burst?.parent) {
			entry.burst.parent.getWorldQuaternion(parentQuaternion).invert();
			entry.burst.quaternion.copy(parentQuaternion.multiply(rig.camera.quaternion));
			const grow = 0.35 + 0.65 * easeInOut(Math.min(1, t * 2.2));
			entry.burst.scale.setScalar(grow);
			for (const child of entry.burst.children) {
				const material = (child as Line2 | Sprite).material as LineMaterial | SpriteMaterial;
				material.opacity = child.userData.flash ? 0.9 * (1 - t) * (1 - t) : 0.9 * (1 - t);
			}
		}
		return true;
	}

	/* ------------------------------------------------------------------ *
	 * Motion: sweeps after a log, laps of closed orbits.
	 * ------------------------------------------------------------------ */

	const at = new Vector3();

	function onScreen(entry: SceneNode): boolean {
		if (!drawn(entry.holder)) return false;
		entry.holder.getWorldPosition(at);
		const point = projectToScreen(at, rig.camera, viewport);
		return (
			point.inFront &&
			point.x >= -40 &&
			point.y >= -40 &&
			point.x <= viewport.width + 40 &&
			point.y <= viewport.height + 40
		);
	}

	/** Move every goal for this frame. True while anything is still moving on screen. */
	function advance(time: number): boolean {
		let more = false;
		for (const entry of universe.byGoal.values()) {
			if (entry.sweep) {
				const t = animate ? Math.min(1, (time - entry.sweep.start) / SWEEP_MS) : 1;
				const { from, to } = entry.sweep;
				setShown(entry, from + (to - from) * easeInOut(t));
				if (t >= 1) {
					entry.sweep = null;
					if (entry.node.closed) entry.lapStart = time;
				} else {
					more = true;
				}
				continue;
			}
			if (!entry.node.closed || entry.lapStart === null || !entry.pivot) continue;
			if (!animate) {
				// The still universe: a closed body waits at its start mark on the
				// full ring, which is what 100% looks like, and laps from there
				// if motion is allowed again.
				entry.pivot.rotation.y = -Math.PI * 2;
				entry.lapStart = time;
				continue;
			}
			const laps = (time - entry.lapStart) / 1000 / entry.node.lapSeconds;
			entry.pivot.rotation.y = -Math.PI * 2 * (1 + (laps % 1));
			if (onScreen(entry)) more = true;
		}
		return more;
	}

	/* ------------------------------------------------------------------ *
	 * The frame.
	 * ------------------------------------------------------------------ */

	function frame(time: number): boolean {
		let more = rig.step(time);
		if (rig.controls.update()) more = true;
		if (advance(time)) more = true;
		universe.scene.updateMatrixWorld();
		if (stepClosing(time)) more = true;
		levelOfDetail(universe, rig.camera, viewport, avoidBoxes());
		renderer.render(universe.scene, rig.camera);
		labels.render(universe.scene, rig.camera);
		return more;
	}

	const loop = createLoop(frame);

	/* ------------------------------------------------------------------ *
	 * Input: taps, the controls, the zoom.
	 * ------------------------------------------------------------------ */

	function* candidates() {
		for (const [goalId, entry] of universe.byGoal) {
			if (!drawn(entry.holder)) continue;
			yield {
				value: { kind: 'goal', goalId } as Picked,
				at: entry.holder.getWorldPosition(new Vector3())
			};
		}
		for (const rock of universe.rocks) {
			if (!drawn(rock.mesh)) continue;
			yield {
				value: { kind: 'rock', id: rock.id } as Picked,
				at: rock.mesh.getWorldPosition(new Vector3())
			};
		}
	}

	let down: { x: number; y: number } | null = null;
	function onPointerDown(event: PointerEvent) {
		down = { x: event.clientX, y: event.clientY };
	}
	function onPointerUp(event: PointerEvent) {
		if (!down) return;
		const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
		down = null;
		if (moved > TAP_SLOP_PX) return;
		const rect = canvas.getBoundingClientRect();
		const picked = nearestOnScreen(
			candidates(),
			rig.camera,
			viewport,
			event.clientX - rect.left,
			event.clientY - rect.top
		);
		options.onpick(picked);
		// A rock is shown where it is; the belt's actions live on Today.
		if (picked?.kind === 'goal') flyTo(picked.goalId);
	}
	canvas.addEventListener('pointerdown', onPointerDown);
	canvas.addEventListener('pointerup', onPointerUp);

	function onControlsChange() {
		loop.request();
		if (!scrubbing) syncZoom();
	}
	function onControlsStart() {
		// A gesture takes the camera back from a flight in progress.
		rig.cancelFlight();
	}
	rig.controls.addEventListener('change', onControlsChange);
	rig.controls.addEventListener('start', onControlsStart);

	function flyTo(goalId: string) {
		const entry = universe.byGoal.get(goalId);
		if (!entry) return;
		universe.scene.updateMatrixWorld(true);
		rig.go(rig.viewFor(entry), !animate, performance.now());
		loop.request();
	}

	function zoomTo(value: number) {
		if (stops.length === 0) return;
		scrubbing = true;
		rig.cancelFlight();
		universe.scene.updateMatrixWorld(true);
		rig.jump(rig.viewAt(stops, Math.min(1, Math.max(0, value))));
		scrubbing = false;
		loop.request();
	}

	/* ------------------------------------------------------------------ *
	 * The page around it: size, visibility, motion, the WebGL context.
	 * ------------------------------------------------------------------ */

	build(false);
	viewport = measure();

	const resizer = new ResizeObserver(resize);
	resizer.observe(host);

	const onVisibility = () => loop.pause('hidden', document.hidden);
	document.addEventListener('visibilitychange', onVisibility);
	onVisibility();

	const intersection = new IntersectionObserver((records) => {
		const record = records[records.length - 1];
		if (record) loop.pause('offscreen', !record.isIntersecting);
	});
	intersection.observe(host);

	const stopMotion = onMotionChange((allowed) => {
		animate = allowed;
		rig.setMotion(allowed);
		loop.request();
	});

	function onContextLost(event: Event) {
		// Without this the browser never offers the context back.
		event.preventDefault();
		loop.pause('lost', true);
		options.onstate('lost');
	}
	function onContextRestored() {
		// The same tree, drawn again from scratch: every buffer and texture the
		// old context held is gone with it.
		glow.needsUpdate = true;
		art.reset();
		build(false);
		universe.resize(viewport);
		loop.pause('lost', false);
		loop.request();
		options.onstate('ready');
	}
	canvas.addEventListener('webglcontextlost', onContextLost);
	canvas.addEventListener('webglcontextrestored', onContextRestored);

	resize();
	// Always the same place on arrival — Home when there is one — never a
	// remembered camera, which is stale the moment a goal is added.
	zoomTo(options.zoom);
	syncZoom();
	loop.request();
	options.onstate('ready');

	// For the end-to-end journey and the screenshot script, which have to tap a
	// body that is a few pixels across and prove a still universe draws no
	// frames. `import.meta.env.DEV` is a literal `false` in a production build,
	// so none of this ships.
	if (import.meta.env.DEV) {
		(window as unknown as { __novaUniverse?: UniverseProbe }).__novaUniverse = {
			where(id) {
				universe.scene.updateMatrixWorld(true);
				const entry = universe.byGoal.get(id);
				const rock = universe.rocks.find((candidate) => candidate.id === id);
				const object = entry?.holder ?? rock?.mesh;
				if (!object || !drawn(object)) return null;
				const point = projectToScreen(object.getWorldPosition(new Vector3()), rig.camera, viewport);
				if (!point.inFront) return null;
				if (point.x < 0 || point.y < 0 || point.x > viewport.width || point.y > viewport.height) {
					return null;
				}
				const rect = canvas.getBoundingClientRect();
				return { x: rect.left + point.x, y: rect.top + point.y };
			},
			rocks: () => universe.rocks.map((rock) => rock.id),
			frames: () => loop.frames,
			settled: () => !rig.flying && !closing
		};
	}

	return {
		update(next) {
			input = next;
			build(true);
			universe.resize(viewport);
			loop.request();
		},
		flyTo,
		zoomTo,
		celebrate(next) {
			if (closing && closing.stamp === next?.stamp) return;
			if (closing) detachBurst(closing.goalId);
			closing = next ? { ...next, start: performance.now() } : null;
			if (closing) attachBurst(closing);
			loop.request();
		},
		setCovered(next) {
			covered = next;
			loop.request();
		},
		destroy() {
			loop.stop();
			resizer.disconnect();
			intersection.disconnect();
			stopMotion();
			document.removeEventListener('visibilitychange', onVisibility);
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('webglcontextlost', onContextLost);
			canvas.removeEventListener('webglcontextrestored', onContextRestored);
			rig.controls.removeEventListener('change', onControlsChange);
			rig.controls.removeEventListener('start', onControlsStart);
			rig.dispose();
			universe.dispose();
			glow.dispose();
			art.dispose();
			renderer.dispose();
			canvas.remove();
			labels.domElement.remove();
		}
	};
}
