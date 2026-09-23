import {
	AdditiveBlending,
	AmbientLight,
	BackSide,
	BufferGeometry,
	CanvasTexture,
	Color,
	DirectionalLight,
	DodecahedronGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	IcosahedronGeometry,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Points,
	PointsMaterial,
	RingGeometry,
	Scene,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector3,
	type Material,
	type Object3D,
	type PerspectiveCamera,
	type Texture
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { hash } from '$domain/hash';
import { TIER_DEFINITIONS, isTier } from '$domain/tiers';
import type { DriftBand } from '$domain/asteroids';
import type { UniverseNode, UniverseTree } from '$domain/universe';
import type { BodyArt } from './art';
import { projectToScreen, type Viewport } from './pick';

/**
 * Meshes, lines and sprites from a `UniverseNode` tree.
 *
 * Nothing in here decides anything about a goal. Which body orbits what, at
 * which radius and angle, how long its trail is and how fast a closed one laps
 * all arrive on the tree from `$domain/universe`; this file turns those numbers
 * into three.js objects and, frame by frame, into positions. The only numbers
 * it owns are how things look — pixel widths, glow sizes, opacities — and the
 * seeded scatter of scenery that is not a goal at all (galaxy arms, the
 * background stars, how a rock tumbles).
 *
 * Everything that must keep its shape at every zoom is sized in pixels, not
 * scene units (#11, decision 6): `LineMaterial` widths are pixels, glows are
 * sprites without size attenuation rescaled from the view's height, and galaxy
 * particles are points of a fixed pixel size. A 2.6-unit trail would vanish at
 * "Multiverse" and be a girder at "Home"; the circles-become-ellipses rule in
 * `CLAUDE.md`, carried into 3D.
 */

/** What the scene draws for a goal that the tree does not carry: words and colour. */
export interface SceneGoal {
	title: string;
	color: string;
	/** Which of the dial's bodies this goal flies, as a key into `BodyArt`. */
	art: string;
	/** Rounded, as the dial's own text says it. */
	percent: number;
}

/** One node of the tree, placed in the scene. */
export interface SceneNode {
	node: UniverseNode;
	host: SceneNode | null;
	/** Where this node sits; its body and its own plane hang off it. */
	holder: Group;
	/** This node's tilted orbital plane, which its children's orbits lie in. */
	plane: Group;
	/** Turns this node round its host. Null for the root. */
	pivot: Group | null;
	/** A universe's bubble, faded as the camera goes inside it. */
	shells: { mesh: Mesh; opacity: number }[];
	goal: SceneGoal | null;
	trail: Line2 | null;
	trailMaterial: LineMaterial | null;
	label: CSS2DObject | null;
	labelSize: { width: number; height: number } | null;
	/** The fraction the trail and body show right now, mid-sweep or not. */
	shown: number;
	sweep: { from: number; to: number; start: number } | null;
	/** When this closed body left the start mark, for its lap. Null while open. */
	lapStart: number | null;
	/** A closing being drawn on this body, if any. */
	burst: Group | null;
	/** The dial's drawing on a billboard, for a goal; null for an anchor. */
	sprite: Sprite | null;
}

export interface SceneRock {
	id: string;
	mesh: Mesh;
	host: SceneNode;
}

export interface UniverseScene {
	scene: Scene;
	byId: Map<string, SceneNode>;
	/** Goal nodes only, by goal id. */
	byGoal: Map<string, SceneNode>;
	everything: SceneNode[];
	rocks: SceneRock[];
	/** Everything whose size is in pixels, for when the view is resized. */
	resize(viewport: Viewport): void;
	dispose(): void;
}

/** How wide each line is, in CSS pixels (decision 6). */
export const LINE = {
	orbit: 1,
	trail: 2.6,
	closed: 3.2,
	start: 1.4,
	ray: 2.2
} as const;

/** Anchors are scenery: grey, dim, and never mistakable for a goal (decision 2). */
const ANCHOR_STAR = '#8f8a80';
const ANCHOR_ORBIT = '#5b6180';
const ORBIT_SEGMENTS = 256;

/** How strong a rock is, by how far it has drifted (decision 13). */
const ROCK_OPACITY: Record<DriftBand, number> = { fresh: 1, drifting: 0.6, faint: 0.3 };

/** A tiny LCG for scenery that is not a goal, so server and client never disagree. */
function seeded(seed: number): () => number {
	let state = seed % 2_147_483_648;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

/** A soft round glow, drawn on a canvas — procedural, not a raster asset. */
export function glowTexture(): Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 64;
	const context = canvas.getContext('2d');
	if (context) {
		const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, 'rgba(255,255,255,1)');
		gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
		gradient.addColorStop(1, 'rgba(255,255,255,0)');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 64, 64);
	}
	return new CanvasTexture(canvas);
}

export function arcPoints(radius: number, from: number, to: number, steps: number): number[] {
	const points: number[] = [];
	for (let step = 0; step <= steps; step += 1) {
		const angle = from + ((to - from) * step) / steps;
		points.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
	}
	return points;
}

/** Builds one scene's worth of objects and remembers what needs a pixel size. */
class Builder {
	readonly lines: LineMaterial[] = [];
	readonly sprites: Sprite[] = [];
	readonly points: { material: PointsMaterial; pixels: number }[] = [];

	constructor(
		readonly glow: Texture,
		readonly pixelRatio: number,
		readonly art: BodyArt
	) {}

	/**
	 * The goal's own body from its dial, on a billboard that always faces the
	 * camera. The drawings fill a circle of radius 1 inside a 4-wide square —
	 * room for rings and panels — so the sprite is four body radii across.
	 */
	body(node: UniverseNode, goal: SceneGoal | null): Sprite | null {
		const map = goal ? this.art.texture(goal.art) : null;
		if (!map) return null;
		const sprite = new Sprite(
			new SpriteMaterial({ map, transparent: true, depthWrite: false, alphaTest: 0.02 })
		);
		sprite.scale.setScalar(node.bodyRadius * 4);
		sprite.userData.body = true;
		return sprite;
	}

	/** A glow held at a pixel radius however far away the camera is. */
	halo(color: Color | string | number, pixels: number, opacity = 1): Sprite {
		const sprite = new Sprite(
			new SpriteMaterial({
				map: this.glow,
				color,
				transparent: true,
				opacity,
				depthWrite: false,
				blending: AdditiveBlending,
				sizeAttenuation: false
			})
		);
		sprite.userData.pixels = pixels;
		this.sprites.push(sprite);
		return sprite;
	}

	line(points: number[], color: Color | string, width: number, opacity = 1): Line2 {
		const geometry = new LineGeometry();
		geometry.setPositions(points);
		const material = new LineMaterial({
			color: new Color(color).getHex(),
			// Pixels, not units — `worldUnits` stays false.
			linewidth: width,
			transparent: true,
			opacity,
			depthWrite: false
		});
		this.lines.push(material);
		return new Line2(geometry, material);
	}

	pointCloud(positions: number[], color: Color | number, pixels: number, opacity: number): Points {
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
		const material = new PointsMaterial({
			color,
			// A point's size is in drawing-buffer pixels, so the ratio keeps it
			// the same size in CSS pixels on a dense screen.
			size: pixels * this.pixelRatio,
			sizeAttenuation: false,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: AdditiveBlending
		});
		this.points.push({ material, pixels });
		return new Points(geometry, material);
	}
}

/**
 * The body at a node's centre. A goal's is its dial's own drawing (see
 * `art.ts`), with the scale's scenery around it — a galaxy's particle disc, a
 * universe's shell — and a glow held at a pixel size so it is never lost to
 * distance. Anchors are grey scenery and have no dial to borrow from.
 */
function bodyFor(node: UniverseNode, goal: SceneGoal | null, build: Builder): Group {
	const group = new Group();
	const radius = node.bodyRadius;
	const color = new Color(goal?.color ?? '#9aa0b4');
	const white = new Color('#ffffff');

	const body = build.body(node, goal);

	switch (node.kind) {
		case 'satellite':
			if (body) group.add(body);
			group.add(build.halo(color, 12, 0.45));
			break;
		case 'planet':
			if (body) group.add(body);
			group.add(build.halo(color, 16, 0.4));
			break;
		case 'dwarf': {
			group.add(
				new Mesh(
					new IcosahedronGeometry(radius, 1),
					new MeshStandardMaterial({ color: 0x6b7080, roughness: 1, flatShading: true })
				)
			);
			group.add(build.halo(0x9aa0b4, 7, 0.35));
			break;
		}
		case 'star': {
			// An anchor star is a dim, colourless one: lit enough to orbit, not
			// enough to be mistaken for a goal.
			const tint = new Color(ANCHOR_STAR);
			group.add(
				new Mesh(new SphereGeometry(radius * 0.6, 32, 16), new MeshBasicMaterial({ color: tint }))
			);
			group.add(build.halo(tint, 22, 0.45));
			break;
		}
		case 'starSystem':
			if (body) group.add(body);
			group.add(build.halo(color, 34, 0.5));
			break;
		case 'galaxy':
		case 'core': {
			const anchor = node.kind === 'core';
			const tint = anchor ? new Color('#8e93a8') : color;
			const random = seeded(hash(`${node.id}arms`));
			const count = anchor ? 2200 : 3000;
			const positions: number[] = [];
			for (let index = 0; index < count; index += 1) {
				const t = Math.pow(random(), 0.6);
				const arm = index % 2;
				const angle = t * 7 + arm * Math.PI + (random() - 0.5) * 0.6;
				const distance = t * node.extent * 1.02;
				positions.push(
					Math.cos(angle) * distance,
					(random() - 0.5) * node.extent * 0.03,
					Math.sin(angle) * distance
				);
			}
			group.add(build.pointCloud(positions, tint, 1.6, anchor ? 0.28 : 0.5));
			if (body) group.add(body);
			group.add(build.halo(tint.clone().lerp(white, 0.4), anchor ? 22 : 30, anchor ? 0.8 : 0.6));
			break;
		}
		case 'universe':
		case 'home': {
			const anchor = node.kind === 'home';
			const tint = anchor ? new Color('#7c8198') : color;
			const wire = new Mesh(
				new IcosahedronGeometry(node.extent, 3),
				new MeshBasicMaterial({
					color: tint,
					wireframe: true,
					transparent: true,
					opacity: anchor ? 0.05 : 0.12,
					depthWrite: false
				})
			);
			wire.userData.shell = true;
			const skin = new Mesh(
				new SphereGeometry(node.extent, 48, 24),
				new MeshBasicMaterial({
					color: tint,
					transparent: true,
					opacity: anchor ? 0.02 : 0.05,
					side: BackSide,
					depthWrite: false
				})
			);
			skin.userData.shell = true;
			group.add(wire, skin, build.halo(tint, anchor ? 24 : 34, anchor ? 0.35 : 0.7));
			if (body) group.add(body);
			break;
		}
		case 'cluster':
			group.add(build.halo(0xfff4d6, 18, 0.5));
			break;
		case 'multiverse':
			// The barycentre: a point nothing sits at, marked so the universes
			// have something visible to go round.
			group.add(build.halo(0xdfe4ff, 10, 0.5));
			break;
	}
	return group;
}

/** A label: the title and percentage beside the body (decision 9). Text only — never markup. */
function labelFor(goal: SceneGoal): CSS2DObject {
	const element = document.createElement('div');
	element.className = 'universe-label';
	element.textContent = goal.title;
	const percent = document.createElement('small');
	percent.textContent = `${goal.percent}%`;
	element.append(percent);
	const label = new CSS2DObject(element);
	// Bottom-centre on the body, so the words sit above it rather than across it.
	label.center.set(0.5, 1);
	return label;
}

export interface BuildOptions {
	glow: Texture;
	art: BodyArt;
	pixelRatio: number;
	viewport: Viewport;
	/** Where to measure labels before they are first shown. */
	labelLayer: HTMLElement;
	/** What each goal's trail showed before this build, so a log sweeps rather than jumps. */
	previous: Map<string, { shown: number; lapStart: number | null }>;
	now: number;
	/** False to draw every trail where it ends up, with no sweep. */
	animate: boolean;
}

export function buildScene(
	tree: UniverseTree,
	goals: Readonly<Record<string, SceneGoal>>,
	options: BuildOptions
): UniverseScene {
	const scene = new Scene();
	scene.add(new AmbientLight(0xb8c4ff, 0.9));
	const sunlight = new DirectionalLight(0xffffff, 1.6);
	sunlight.position.set(1, 1.4, 0.8);
	scene.add(sunlight);

	const build = new Builder(options.glow, options.pixelRatio, options.art);
	const byId = new Map<string, SceneNode>();
	const byGoal = new Map<string, SceneNode>();
	const everything: SceneNode[] = [];
	const rocks: SceneRock[] = [];

	function place(
		node: UniverseNode,
		parent: Object3D,
		host: SceneNode | null,
		pivot: Group | null
	) {
		const holder = new Group();
		parent.add(holder);
		const goal = node.goalId ? (goals[node.goalId] ?? null) : null;
		const body = bodyFor(node, goal, build);
		holder.add(body);

		const plane = new Group();
		plane.rotation.set(node.tilt, node.spin, 0);
		holder.add(plane);

		const before = node.goalId ? options.previous.get(node.goalId) : undefined;
		const target = node.fraction;
		const from = before && options.animate ? before.shown : target;

		const entry: SceneNode = {
			node,
			host,
			holder,
			plane,
			pivot,
			shells: body.children
				.filter((child): child is Mesh => child.userData.shell === true)
				.map((mesh) => ({ mesh, opacity: (mesh.material as MeshBasicMaterial).opacity })),
			goal,
			trail: null,
			trailMaterial: null,
			label: null,
			labelSize: null,
			shown: from,
			sweep: from !== target ? { from, to: target, start: options.now } : null,
			lapStart: node.closed && from === target ? (before?.lapStart ?? options.now) : null,
			burst: null,
			sprite:
				(body.children.find((child) => child.userData.body === true) as Sprite | undefined) ?? null
		};
		byId.set(node.id, entry);
		if (node.goalId) byGoal.set(node.goalId, entry);
		everything.push(entry);

		for (const child of node.children) {
			const radius = child.orbitRadius;
			const childPivot = new Group();
			plane.add(childPivot);

			if (child.goalId) {
				const accent = isTier(child.kind) ? TIER_DEFINITIONS[child.kind].accent : '#ffffff';
				// The orbit: the whole revolution, faint.
				plane.add(
					build.line(arcPoints(radius, 0, Math.PI * 2, ORBIT_SEGMENTS), accent, LINE.orbit, 0.35)
				);
				// The start mark, so "how far round" has somewhere to count from.
				const reach = child.extent * 0.6 + 0.1;
				plane.add(build.line([radius - reach, 0, 0, radius + reach, 0, 0], '#ffffff', 1.4, 0.5));
			} else {
				// An anchor: parked at a seeded angle, its orbit only a whisper.
				plane.add(build.line(arcPoints(radius, 0, Math.PI * 2, 128), ANCHOR_ORBIT, 1, 0.14));
				childPivot.rotation.y = -child.angle;
			}

			const seat = new Group();
			seat.position.x = radius;
			childPivot.add(seat);
			const placed = place(child, seat, entry, childPivot);

			if (child.goalId && placed.goal) {
				placed.trailMaterial = new LineMaterial({
					color: new Color(placed.goal.color).getHex(),
					linewidth: child.closed ? LINE.closed : LINE.trail,
					transparent: true,
					opacity: 0.95,
					depthWrite: false
				});
				build.lines.push(placed.trailMaterial);
				placed.trail = new Line2(new LineGeometry(), placed.trailMaterial);
				plane.add(placed.trail);
				setShown(placed, placed.shown);

				placed.label = labelFor(placed.goal);
				placed.holder.add(placed.label);
			}
		}

		if (node.belt) drawBelt(entry, build, rocks);
		return entry;
	}

	place(tree.root, scene, null, null);
	scene.add(background(build));

	// Measure each label once, while it is still in the flow: the renderer
	// hides the ones it does not show, and a hidden element has no size.
	for (const entry of byGoal.values()) {
		if (!entry.label) continue;
		options.labelLayer.append(entry.label.element);
	}
	for (const entry of byGoal.values()) {
		if (!entry.label) continue;
		entry.labelSize = {
			width: entry.label.element.offsetWidth,
			height: entry.label.element.offsetHeight
		};
		entry.label.element.style.display = 'none';
	}

	const universe: UniverseScene = {
		scene,
		byId,
		byGoal,
		everything,
		rocks,
		resize(viewport) {
			for (const material of build.lines) material.resolution.set(viewport.width, viewport.height);
			for (const sprite of build.sprites) {
				// Without size attenuation a sprite's scale is in view space at unit
				// depth; `tan(fov / 2)` over half the height turns pixels into that.
				const k = (2 * (sprite.userData.pixels as number) * viewport.tanHalfFov) / viewport.height;
				sprite.scale.set(k * 2, k * 2, 1);
			}
		},
		dispose() {
			scene.traverse((object) => {
				const disposable = object as Object3D & {
					geometry?: BufferGeometry;
					material?: Material | Material[];
				};
				// A sprite's geometry is one three shares between every sprite.
				if (!(object instanceof Sprite)) disposable.geometry?.dispose();
				const materials = Array.isArray(disposable.material)
					? disposable.material
					: disposable.material
						? [disposable.material]
						: [];
				for (const material of materials) material.dispose();
				if (object instanceof CSS2DObject) object.element.remove();
			});
		}
	};
	universe.resize(options.viewport);
	return universe;
}

/**
 * Put a goal's body and trail at `fraction` of the way round, together — the
 * dial's rule that position and fill are the same fact said twice.
 */
export function setShown(entry: SceneNode, fraction: number): void {
	entry.shown = fraction;
	if (entry.pivot) entry.pivot.rotation.y = -Math.PI * 2 * Math.min(fraction, 1);
	if (!entry.trail) return;

	const radius = entry.node.orbitRadius;
	entry.trail.visible = fraction > 0;
	if (fraction <= 0) return;
	const steps = Math.max(8, Math.ceil(ORBIT_SEGMENTS * Math.min(fraction, 1)));
	// A fresh geometry rather than new positions on the old one: LineGeometry
	// allocates new buffers either way, and only disposing the old geometry
	// hands its buffers back to the GPU.
	const geometry = new LineGeometry();
	geometry.setPositions(arcPoints(radius, 0, Math.PI * 2 * Math.min(fraction, 1), steps));
	entry.trail.geometry.dispose();
	entry.trail.geometry = geometry;
}

function drawBelt(host: SceneNode, build: Builder, rocks: SceneRock[]): void {
	const belt = host.node.belt;
	if (!belt) return;
	const random = seeded(hash(`${host.node.id}belt`));

	// A faint band says where the belt is, however few rocks are in it.
	const band = new Mesh(
		new RingGeometry(belt.inner, belt.inner + belt.width, 96),
		new MeshBasicMaterial({
			color: 0xb8a98f,
			side: DoubleSide,
			transparent: true,
			opacity: 0.05,
			depthWrite: false
		})
	);
	band.rotation.x = Math.PI / 2;
	host.plane.add(band);

	for (const rock of belt.rocks) {
		const opacity = ROCK_OPACITY[rock.band];
		const size = host.node.bodyRadius * (0.16 + (hash(`${rock.id}s`) % 10) / 90);
		const mesh = new Mesh(
			new DodecahedronGeometry(size, 0),
			new MeshStandardMaterial({
				color: 0xd6c6a4,
				roughness: 1,
				flatShading: true,
				transparent: true,
				opacity
			})
		);
		mesh.position.set(
			Math.cos(rock.angle) * rock.radius,
			(random() - 0.5) * belt.width * 0.1,
			Math.sin(rock.angle) * rock.radius
		);
		mesh.rotation.set(random() * 3, random() * 3, 0);
		host.plane.add(mesh);
		const speck = build.halo(0xe8d5a8, 10, opacity * 0.8);
		speck.position.copy(mesh.position);
		host.plane.add(speck);
		rocks.push({ id: rock.id, mesh, host });
	}
}

/** A distant, seeded sky, far behind everything. */
function background(build: Builder): Points {
	const random = seeded(7);
	const positions: number[] = [];
	for (let index = 0; index < 1500; index += 1) {
		const u = random() * 2 - 1;
		const turn = random() * Math.PI * 2;
		const ring = Math.sqrt(1 - u * u);
		const distance = 2e7;
		positions.push(
			Math.cos(turn) * ring * distance,
			u * distance,
			Math.sin(turn) * ring * distance
		);
	}
	return build.pointCloud(positions, 0xaab4e0, 1.2, 0.9);
}

/** Whether this node and everything it hangs from is drawn. */
export function drawn(object: Object3D): boolean {
	for (let current: Object3D | null = object; current; current = current.parent) {
		if (!current.visible) return false;
	}
	return true;
}

const hostAt = new Vector3();
const nodeAt = new Vector3();
const eyeTo = new Vector3();

/**
 * The smallest a goal's drawing is ever shown, in pixels across its billboard
 * (twice the body itself, which fills the middle half). The drawing is the
 * dial's, and a dial's body is never a speck: under this, a planet a few
 * scene units wide would be two pixels of colour lost in its own glow.
 */
export const MIN_BODY_PX: Record<string, number> = {
	satellite: 22,
	planet: 30,
	starSystem: 38,
	galaxy: 46,
	universe: 54
};

/** Under this many pixels from its host, a system folds into its host's glow (decision 6). */
export const FOLD_PX = 12;
/** A label needs this much room from its host before it is worth reading (decision 9). */
export const LABEL_ROOM_PX = 70;
/** Never more labels than this at once. */
export const MAX_LABELS = 12;

/** A screen rectangle, in CSS pixels from the view's top left. */
export interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Level of detail for this frame: which systems fold into their host, how
 * much of a universe's shell to show from where the camera is, and which
 * labels are shown once they have been decluttered. A label is never drawn
 * half off the view or across anything in `avoid` — the zoom's own words.
 */
export function levelOfDetail(
	universe: UniverseScene,
	camera: PerspectiveCamera,
	viewport: Viewport,
	avoid: readonly Box[] = []
): void {
	const eye = camera.position;

	const worldPerPixelAtUnit = (2 * viewport.tanHalfFov) / viewport.height;
	for (const entry of universe.everything) {
		entry.holder.getWorldPosition(nodeAt);
		if (entry.sprite) {
			const least =
				(MIN_BODY_PX[entry.node.kind] ?? 0) * worldPerPixelAtUnit * eye.distanceTo(nodeAt);
			entry.sprite.scale.setScalar(Math.max(entry.node.bodyRadius * 4, least));
		}
		if (entry.host) {
			entry.host.holder.getWorldPosition(hostAt);
			const a = projectToScreen(hostAt, camera, viewport);
			const b = projectToScreen(nodeAt, camera, viewport);
			entry.holder.visible = Math.hypot(a.x - b.x, a.y - b.y) >= FOLD_PX;
		}
		// A universe seen from inside is the space you are in, not a wireframe
		// across the view: its shell fades as the camera enters it.
		if (entry.shells.length > 0) {
			const distance = eyeTo.copy(eye).distanceTo(nodeAt);
			const extent = entry.node.extent;
			const k = Math.min(1, Math.max(0, (distance - extent * 0.9) / (extent * 0.8)));
			for (const shell of entry.shells) {
				(shell.mesh.material as MeshBasicMaterial).opacity = shell.opacity * k;
			}
		}
	}

	// Labels that have room, then declutter: larger body on screen first, then
	// nearer, and never two overlapping or more than twelve.
	const candidates: {
		entry: SceneNode;
		x: number;
		y: number;
		size: number;
		distance: number;
	}[] = [];
	for (const entry of universe.byGoal.values()) {
		if (!entry.label || !entry.host) continue;
		entry.label.visible = false;
		if (!drawn(entry.holder)) continue;
		entry.holder.getWorldPosition(nodeAt);
		entry.host.holder.getWorldPosition(hostAt);
		const a = projectToScreen(hostAt, camera, viewport);
		const b = projectToScreen(nodeAt, camera, viewport);
		if (!b.inFront || Math.hypot(a.x - b.x, a.y - b.y) <= LABEL_ROOM_PX) continue;
		const distance = eye.distanceTo(nodeAt);
		candidates.push({
			entry,
			x: b.x,
			y: b.y,
			size: entry.node.bodyRadius / Math.max(distance, 1e-6) / viewport.tanHalfFov,
			distance
		});
	}
	candidates.sort((a, b) => b.size - a.size || a.distance - b.distance);

	const taken: Box[] = [...avoid];
	let shownLabels = 0;
	for (const candidate of candidates) {
		if (shownLabels >= MAX_LABELS) break;
		const size = candidate.entry.labelSize ?? { width: 80, height: 24 };
		const box: Box = {
			left: candidate.x - size.width / 2,
			right: candidate.x + size.width / 2,
			top: candidate.y - size.height,
			bottom: candidate.y
		};
		const inside =
			box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;
		if (!inside || taken.some((other) => overlaps(box, other))) continue;
		taken.push(box);
		shownLabels += 1;
		if (candidate.entry.label) candidate.entry.label.visible = true;
	}
}
