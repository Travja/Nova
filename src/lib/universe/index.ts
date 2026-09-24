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
import { Kit } from './bodies';
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
	/** The goal whose closing the universe is lighting right now, if any. */
	celebrating(): string | null;
	/** The last goal whose closing the universe lit, however long ago. */
	celebrated(): string | null;
	/** Fly to a goal, as a tap on it would. */
	flyTo(goalId: string): void;
}

/** The frame interval when only ambient motion is running: 30fps. */
const AMBIENT_FRAME_MS = 1000 / 30 - 2;

/** How far a closing's rays reach, in the body's own radii (decision 12). */
const BURST_REACH = 6;
/** The white flash at a closing body, a glow held at this radius in pixels. */
const FLASH_PX = 90;
/** A gap between frames longer than this is a stall, not time a moment should spend. */
const STALL_MS = 120;

/** The least a burst's rays reach on screen, in pixels, however far out the camera is. */
const MIN_BURST_PX = 70;

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
	// Planet bands, ring lanes, flares: drawn once, kept across rebuilds.
	const kit = new Kit(glow);

	let input = initial;
	let viewport: Viewport = { width: 1, height: 1, tanHalfFov: Math.tan(Math.PI / 7.2) };
	// Assigned by the first `build()`, below, before anything reads it.
	let universe!: UniverseScene;
	let stops: SceneNode[] = [];
	/** A closing being played in the universe: lit, and bursting unless motion is off. */
	interface Playing extends Closing {
		/**
		 * When the moment starts, set by the first frame that can draw it — not
		 * by the clock when it was asked for, since a rebuild or a slow first
		 * frame could otherwise use the whole moment up before it is seen.
		 */
		start: number | null;
		/** How long after that first frame: long enough for a sweep to land first. */
		delay: number;
		lit: boolean;
		spokes: Group | null;
		flash: Sprite | null;
	}
	let closing: Playing | null = null;
	/** For the dev probe: the last closing actually drawn. */
	let lastLit: string | null = null;
	let covered = false;
	/**
	 * What arrived while a sheet was over the view: the new data and the
	 * closing. Both wait for the sheet to close, so the moment plays where it
	 * can be seen — the trail sweeping round, then the ring lighting — rather
	 * than under the sheet, a second before anyone could look.
	 */
	let pendingInput: UniverseInput | null = null;
	let pendingClosing: Closing | null = null;
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
			kit,
			pixelRatio,
			viewport,
			labelLayer: labels.domElement,
			previous,
			now: performance.now(),
			animate: sweep && animate
		});
		// A sweep is timed from the first frame that draws it, for the same
		// reason a closing is: the rebuild itself must not use it up.
		for (const entry of universe.byGoal.values()) {
			if (entry.sweep) entry.sweep.start = Number.NaN;
		}
		universe.scene.updateMatrixWorld(true);
		stops = input.stops
			.map((stop) => universe.byId.get(stop.id))
			.filter((entry): entry is SceneNode => entry !== undefined);
		// The old scene took the burst with it; the next frame lights the new one.
		if (closing) {
			closing.lit = false;
			closing.spokes = null;
			closing.flash = null;
		}
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

	/** The ring lit for the moment — twice as wide and brighter — or put back. */
	function light(entry: SceneNode, on: boolean) {
		if (!entry.trailMaterial || !entry.goal) return;
		entry.trailMaterial.linewidth = on
			? LINE.closed * 2
			: entry.node.closed
				? LINE.closed
				: LINE.trail;
		entry.trailMaterial.color.set(
			on ? new Color(entry.goal.color).lerp(new Color('#ffffff'), 0.35) : entry.goal.color
		);
	}

	/**
	 * Rays in unit body radii — scaled each frame to the body as it is drawn,
	 * and never smaller than `MIN_BURST_PX` — and a white flash held at a
	 * pixel size, both at the body.
	 */
	function attachBurst(current: Playing, entry: SceneNode) {
		const rays = new Group();
		const color = new Color(entry.goal?.color ?? '#ffffff');
		for (let index = 0; index < current.rays; index += 1) {
			const angle = (index / current.rays) * Math.PI * 2;
			const geometry = new LineGeometry();
			geometry.setPositions([
				Math.cos(angle) * 1.6,
				Math.sin(angle) * 1.6,
				0,
				Math.cos(angle) * BURST_REACH,
				Math.sin(angle) * BURST_REACH,
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
			rays.add(new Line2(geometry, material));
		}
		const flash = new Sprite(
			new SpriteMaterial({
				map: glow,
				color: 0xffffff,
				transparent: true,
				opacity: 0.9,
				depthWrite: false,
				// Over the body, not behind it: the flash is the body lighting up.
				depthTest: false,
				blending: AdditiveBlending,
				sizeAttenuation: false
			})
		);
		flash.renderOrder = 10;
		const k = (4 * FLASH_PX * viewport.tanHalfFov) / viewport.height;
		flash.scale.set(k, k, 1);
		entry.holder.add(rays, flash);
		current.spokes = rays;
		current.flash = flash;
	}

	function detachBurst(current: Playing) {
		const entry = universe.byGoal.get(current.goalId);
		if (entry) light(entry, false);
		for (const line of current.spokes?.children ?? []) {
			(line as Line2).geometry.dispose();
			(line as Line2).material.dispose();
		}
		current.spokes?.removeFromParent();
		// A sprite's geometry is one three shares between every sprite.
		current.flash?.material.dispose();
		current.flash?.removeFromParent();
		current.spokes = null;
		current.flash = null;
	}

	function play(next: Closing, delay: number) {
		if (closing) detachBurst(closing);
		closing = { ...next, start: null, delay, lit: false, spokes: null, flash: null };
		loop.request();
	}

	const parentQuaternion = new Quaternion();
	const burstAt = new Vector3();

	/** Advance the closing. True while there is more of it, including the wait for a sweep. */
	function stepClosing(time: number): boolean {
		if (!closing) return false;
		const entry = universe.byGoal.get(closing.goalId);
		if (!entry) {
			closing = null;
			return false;
		}
		closing.start ??= time + closing.delay;
		const t = (time - closing.start) / closing.ms;
		if (t < 0) return true;
		if (t >= 1) {
			detachBurst(closing);
			closing = null;
			return false;
		}
		if (!closing.lit) {
			light(entry, true);
			// Under reduced motion the lit ring is the whole closing.
			if (animate) attachBurst(closing, entry);
			closing.lit = true;
			lastLit = closing.goalId;
		}
		const { spokes: rays, flash } = closing;
		if (rays) {
			rays.parent?.getWorldQuaternion(parentQuaternion).invert();
			rays.quaternion.copy(parentQuaternion.multiply(rig.camera.quaternion));
			// As big as the body is drawn, and never too small to see from here.
			entry.holder.getWorldPosition(burstAt);
			const worldPerPixel =
				((2 * viewport.tanHalfFov) / viewport.height) * rig.camera.position.distanceTo(burstAt);
			const radius = Math.max(
				entry.model?.scale.x ?? entry.node.bodyRadius,
				(MIN_BURST_PX / BURST_REACH) * worldPerPixel
			);
			const grow = 0.35 + 0.65 * easeInOut(Math.min(1, t * 2.2));
			rays.scale.setScalar(radius * grow);
			for (const line of rays.children) {
				((line as Line2).material as LineMaterial).opacity = 0.9 * (1 - t);
			}
		}
		if (flash) flash.material.opacity = 0.9 * (1 - t) * (1 - t);
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

	/** Sweep every goal a log moved. True while any sweep is still under way. */
	function sweep(time: number): boolean {
		let more = false;
		for (const entry of universe.byGoal.values()) {
			if (!entry.sweep) continue;
			if (Number.isNaN(entry.sweep.start)) entry.sweep.start = time;
			const t = animate ? Math.min(1, (time - entry.sweep.start) / SWEEP_MS) : 1;
			const { from, to } = entry.sweep;
			setShown(entry, from + (to - from) * easeInOut(t));
			if (t >= 1) {
				entry.sweep = null;
				if (entry.node.closed) entry.lapStart = time;
			} else {
				more = true;
			}
		}
		return more;
	}

	/** Bodies put back in their rest pose since motion was last stopped. */
	const resting = new WeakSet<SceneNode>();

	/**
	 * The motion that runs by itself: closed orbits lapping, and every body's
	 * own life — worlds turning, craft rocking, stars flaring. True while any of
	 * it is on screen. None of it runs under reduced motion.
	 */
	function ambient(time: number): boolean {
		let more = false;
		for (const entry of universe.everything) {
			if (entry.live) {
				if (!animate) {
					if (!resting.has(entry)) entry.live(0);
					resting.add(entry);
				} else if (drawn(entry.holder) && (entry.model === null || onScreen(entry))) {
					resting.delete(entry);
					entry.live(time / 1000);
					more = true;
				}
			}
			if (entry.sweep || !entry.node.closed || entry.lapStart === null || !entry.pivot) continue;
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

	let lastDrawn = -Infinity;
	let alive = false;

	let lastFrame: number | null = null;

	/**
	 * A frame that arrives long after the last — a rebuild, shaders compiling
	 * on a slow GPU, a phone busy elsewhere — must not use up a moment nobody
	 * saw. Sweeps and the closing are carried forward past the gap, so they
	 * play in full once frames are coming again.
	 */
	function bridge(time: number) {
		const gap = lastFrame === null ? 0 : time - lastFrame;
		lastFrame = time;
		if (gap < STALL_MS) return;
		const lost = gap - 1000 / 60;
		if (closing?.start != null) closing.start += lost;
		for (const entry of universe.byGoal.values()) {
			if (entry.sweep && !Number.isNaN(entry.sweep.start)) entry.sweep.start += lost;
		}
	}

	function frame(time: number): boolean {
		// Under a sheet the universe goes quiet — once the flight a tap started
		// has landed, so what shows above the sheet is not frozen mid-air.
		if (covered && !rig.flying) {
			loop.pause('covered', true);
			return false;
		}
		bridge(time);
		let busy = rig.step(time);
		if (rig.controls.update()) busy = true;
		if (sweep(time)) busy = true;
		if (closing) busy = true;
		// Nothing but the universe's own life moving: half the frame rate is
		// plenty for a world turning, and half the battery on a phone.
		if (!busy && alive && time - lastDrawn < AMBIENT_FRAME_MS) return true;

		alive = ambient(time);
		universe.scene.updateMatrixWorld();
		follow();
		const closingMore = stepClosing(time);
		levelOfDetail(universe, rig.camera, viewport, avoidBoxes());
		renderer.render(universe.scene, rig.camera);
		labels.render(universe.scene, rig.camera);
		lastDrawn = time;
		return busy || alive || closingMore;
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
		// A gesture takes the camera back — from a flight, and from a body it
		// was keeping in view.
		rig.cancelFlight();
		focus = null;
	}
	rig.controls.addEventListener('change', onControlsChange);
	rig.controls.addEventListener('start', onControlsStart);

	/**
	 * The body the camera was last sent to, and where it was. A tap is someone
	 * asking to look at that body, and a closed one keeps lapping — framed
	 * close, it would be out of the frame a second later — so the camera
	 * keeps it where it is until the next gesture, scrub or tap sends it
	 * elsewhere. An open body is parked, and this never moves anything.
	 */
	let focus: { goalId: string; at: Vector3 } | null = null;
	const followAt = new Vector3();

	function follow() {
		if (!focus) return;
		const entry = universe.byGoal.get(focus.goalId);
		if (!entry) {
			focus = null;
			return;
		}
		entry.holder.getWorldPosition(followAt);
		const delta = followAt.clone().sub(focus.at);
		if (delta.lengthSq() > 0) rig.shift(delta);
		focus.at.copy(followAt);
	}

	function flyTo(goalId: string) {
		const entry = universe.byGoal.get(goalId);
		if (!entry) return;
		universe.scene.updateMatrixWorld(true);
		rig.go(rig.viewFor(entry), !animate, performance.now());
		focus = { goalId, at: entry.holder.getWorldPosition(new Vector3()) };
		loop.request();
	}

	function zoomTo(value: number) {
		if (stops.length === 0) return;
		scrubbing = true;
		rig.cancelFlight();
		focus = null;
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
			settled: () => !rig.flying && !closing,
			celebrating: () => (closing?.lit ? closing.goalId : null),
			celebrated: () => lastLit,
			flyTo: (goalId) => flyTo(goalId)
		};
	}

	return {
		update(next) {
			if (covered) {
				pendingInput = next;
				return;
			}
			input = next;
			build(true);
			universe.resize(viewport);
			loop.request();
		},
		flyTo,
		zoomTo,
		celebrate(next) {
			// The store clearing its closing is not the universe's cue to stop:
			// a closing plays out on its own clock, which may not have started.
			if (!next) return;
			if (closing?.stamp === next.stamp || pendingClosing?.stamp === next.stamp) return;
			if (covered) pendingClosing = next;
			else play(next, 0);
		},
		setCovered(next) {
			if (covered === next) return;
			covered = next;
			// Nothing draws under a sheet: it is the sheet's moment, and a GPU
			// busy behind it only takes frames from the sheet's own burst. The
			// next frame pauses the loop, after any flight in progress lands.
			if (next) {
				loop.request();
				return;
			}
			loop.pause('covered', false);
			let sweeping = false;
			if (pendingInput) {
				input = pendingInput;
				pendingInput = null;
				build(true);
				universe.resize(viewport);
				sweeping = animate;
			}
			if (pendingClosing) {
				// After the trail has swept round to meet it, as a dial does.
				play(pendingClosing, sweeping ? SWEEP_MS : 0);
				pendingClosing = null;
			}
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
			kit.dispose();
			renderer.dispose();
			canvas.remove();
			labels.domElement.remove();
		}
	};
}
