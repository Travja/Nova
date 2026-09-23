import {
	AdditiveBlending,
	BackSide,
	BoxGeometry,
	BufferGeometry,
	CanvasTexture,
	Color,
	CylinderGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	FrontSide,
	LatheGeometry,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	Points,
	PointsMaterial,
	RingGeometry,
	SRGBColorSpace,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	TorusGeometry,
	Vector2,
	Vector3,
	type Object3D,
	type Texture
} from 'three';
import { hash } from '$domain/hash';
import type { Tier } from '$domain/tiers';

/**
 * The dial's bodies (#10), built in three dimensions.
 *
 * Each tier's three variants keep the silhouette and palette their flat
 * drawings have — a comsat with its two panels, a cratered moon, a dish probe;
 * a banded world, a ringed one, an ice world; a star with its little worlds, a
 * binary pair, a star with one ringed world; a spiral, barred or elliptical
 * galaxy; a hazy, nebulous or web-strung universe — so a goal is recognisably
 * the same thing in both views. Here they are solid, lit from one side, and
 * alive: worlds turn on their axes, craft rock on their struts, stars flare,
 * little worlds go round their stars and galaxies swirl, at the pace the dials
 * animate at.
 *
 * None of that motion says anything about progress — the orbit and the trail
 * do that — which is why it all lives here, why anchors never have any, and
 * why reduced motion leaves every body in its rest pose.
 *
 * Built in unit space: a body's drawing fills a radius of 1, and the caller
 * scales it to the node's `bodyRadius`. Galaxy discs and universe interiors are
 * the exception: they are sized by the node's `extent`, since that is what they
 * are the shape of.
 */

/** Seconds for one turn of whatever a body turns: `TierBody`'s default `spinSeconds`. */
const SPIN = 26;

/** The dial's three shades of a goal's colour, mixed the way `TierBody`'s CSS mixes them. */
export interface Palette {
	lit: Color;
	pale: Color;
	deep: Color;
	key: string;
}

function mix(a: string, b: string, t: number): Color {
	const from = new Color(a);
	const to = new Color(b);
	// color-mix(in srgb …): mix the sRGB components, not the linear ones.
	const [ar, ag, ab] = [from.r, from.g, from.b].map((v) => linearToSrgb(v));
	const [br, bg, bb] = [to.r, to.g, to.b].map((v) => linearToSrgb(v));
	return new Color().setRGB(
		ar + (br - ar) * t,
		ag + (bg - ag) * t,
		ab + (bb - ab) * t,
		SRGBColorSpace
	);
}

function linearToSrgb(value: number): number {
	return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** As `TierBody` does it: lit is the colour, pale 42% of it into white, deep 40% of it into space. */
export function palette(color: string, dormant: boolean): Palette {
	if (dormant) {
		return {
			lit: new Color('#7c87b4'),
			pale: new Color('#97a1c6'),
			deep: new Color('#444e75'),
			key: 'dormant'
		};
	}
	return {
		lit: new Color(color),
		pale: mix(color, '#ffffff', 0.58),
		deep: mix(color, '#05070f', 0.6),
		key: color
	};
}

const css = (color: Color) => `#${color.getHexString()}`;

/** A seeded LCG, so every crater and particle lands in the same place on every visit. */
function seeded(seed: number): () => number {
	let state = seed % 2_147_483_648;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

/**
 * Procedural textures, made once and kept across scene rebuilds: a planet's
 * bands, an ice cap, a ring's lanes, a star's four-point flare. Drawn on
 * canvases, so no raster asset ships.
 */
export class Kit {
	private readonly cache = new Map<string, Texture>();

	constructor(readonly glow: Texture) {}

	texture(key: string, size: [number, number], draw: (g: CanvasRenderingContext2D) => void) {
		const known = this.cache.get(key);
		if (known) return known;
		const canvas = document.createElement('canvas');
		[canvas.width, canvas.height] = size;
		const context = canvas.getContext('2d');
		if (context) draw(context);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		texture.anisotropy = 4;
		this.cache.set(key, texture);
		return texture;
	}

	/** The dial's flare path — four long points and four short — as a soft-edged sprite map. */
	flare(): Texture {
		return this.texture('flare', [128, 128], (g) => {
			g.translate(64, 64);
			g.fillStyle = '#ffffff';
			g.shadowColor = '#ffffff';
			g.shadowBlur = 6;
			const long = 60;
			const waist = 5;
			g.beginPath();
			for (let point = 0; point < 4; point += 1) {
				const angle = (point * Math.PI) / 2;
				const next = angle + Math.PI / 4;
				g.lineTo(Math.cos(angle) * long, Math.sin(angle) * long);
				g.lineTo(Math.cos(next) * waist, Math.sin(next) * waist);
			}
			g.closePath();
			g.fill();
		});
	}

	dispose(): void {
		for (const texture of this.cache.values()) texture.dispose();
		this.cache.clear();
	}
}

/** A body and what brings it to life. `live` is called with seconds since the page opened. */
export interface Body {
	object: Object3D;
	live: ((seconds: number) => void) | null;
}

function standard(color: Color, options: { roughness?: number; metalness?: number } = {}) {
	return new MeshStandardMaterial({
		color,
		roughness: options.roughness ?? 0.6,
		metalness: options.metalness ?? 0.1
	});
}

/** A glow in world units, which grows as you come closer — a corona, not a marker. */
function aura(kit: Kit, color: Color, size: number, opacity: number, map?: Texture): Sprite {
	const sprite = new Sprite(
		new SpriteMaterial({
			map: map ?? kit.glow,
			color,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: AdditiveBlending
		})
	);
	sprite.scale.setScalar(size);
	return sprite;
}

const swing = (seconds: number, period: number) => Math.sin((seconds / period) * Math.PI * 2);

/* -------------------------------------------------------------------------- *
 * Satellites
 * -------------------------------------------------------------------------- */

function panelTexture(kit: Kit, colors: Palette): Texture {
	return kit.texture(`panel-${colors.key}`, [64, 64], (g) => {
		g.fillStyle = css(colors.deep);
		g.fillRect(0, 0, 64, 64);
		g.strokeStyle = css(colors.lit);
		g.globalAlpha = 0.75;
		g.lineWidth = 2;
		for (let line = 16; line < 64; line += 16) {
			g.beginPath();
			g.moveTo(line, 0);
			g.lineTo(line, 64);
			g.stroke();
		}
		g.globalAlpha = 1;
		g.lineWidth = 4;
		g.strokeRect(2, 2, 60, 60);
	});
}

function beacon(): Mesh {
	return new Mesh(
		new SphereGeometry(0.15, 12, 8),
		new MeshBasicMaterial({ color: '#fff6d8', transparent: true })
	);
}

/** The dial's beacon: on for 46% of every 2.6 seconds, then nearly out. */
function blink(light: Mesh, seconds: number): void {
	(light.material as MeshBasicMaterial).opacity = (seconds / 2.6) % 1 < 0.46 ? 1 : 0.15;
}

function comsat(colors: Palette, kit: Kit): Body {
	const craft = new Group();
	const hull = new Mesh(
		new BoxGeometry(1.1, 1.3, 0.8),
		standard(colors.lit.clone().lerp(colors.pale, 0.5), { metalness: 0.3, roughness: 0.55 })
	);
	const strut = new Mesh(new CylinderGeometry(0.05, 0.05, 1.7, 8), standard(colors.pale));
	strut.rotation.z = Math.PI / 2;
	const panelMaterial = new MeshStandardMaterial({
		map: panelTexture(kit, colors),
		metalness: 0.4,
		roughness: 0.35,
		emissive: colors.lit,
		emissiveIntensity: 0.12
	});
	for (const side of [-1, 1]) {
		const panel = new Mesh(new BoxGeometry(0.98, 0.96, 0.04), panelMaterial);
		panel.position.x = side * 1.3;
		craft.add(panel);
	}
	const mast = new Mesh(new CylinderGeometry(0.05, 0.05, 0.34, 8), standard(colors.pale));
	mast.position.y = 0.8;
	const dish = new Mesh(
		new SphereGeometry(0.42, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
		new MeshStandardMaterial({ color: colors.pale, side: DoubleSide, metalness: 0.3 })
	);
	dish.rotation.x = Math.PI;
	dish.position.y = 1.2;
	const light = beacon();
	light.position.y = -0.82;
	craft.add(hull, strut, mast, dish, light);

	return {
		object: craft,
		live(seconds) {
			// Rocking on its strut as the dial's does, and slowly turning to show
			// the panels edge-on and face-on in turn.
			craft.rotation.z = (swing(seconds, SPIN * 0.7) * (7 * Math.PI)) / 180;
			craft.rotation.y = seconds * 0.25;
			blink(light, seconds);
		}
	};
}

/** A moon, its craters pressed into the surface rather than painted on. */
function moon(colors: Palette, seed: string): Body {
	// Indexed, so shared vertices get smooth normals once the craters are pressed in.
	const geometry = new SphereGeometry(1, 72, 48);
	const random = seeded(hash(`${seed}craters`));
	const craters = Array.from({ length: 9 }, () => {
		const direction = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
		return { direction, size: 0.18 + random() * 0.3, depth: 0.05 + random() * 0.05 };
	});
	const position = geometry.getAttribute('position');
	const colors3: number[] = [];
	const point = new Vector3();
	for (let index = 0; index < position.count; index += 1) {
		point.fromBufferAttribute(position, index).normalize();
		let radius = 1;
		let shade = 0;
		for (const crater of craters) {
			const distance = point.angleTo(crater.direction) / crater.size;
			if (distance < 1) {
				radius -= crater.depth * (1 - distance * distance);
				shade = Math.max(shade, 0.75 * (1 - distance));
			} else if (distance < 1.25) {
				// The rim, thrown up round the bowl.
				radius += crater.depth * 0.35 * (1 - (distance - 1) / 0.25);
			}
		}
		point.multiplyScalar(radius);
		position.setXYZ(index, point.x, point.y, point.z);
		const tone = colors.lit.clone().lerp(colors.deep, shade);
		colors3.push(tone.r, tone.g, tone.b);
	}
	geometry.setAttribute('color', new Float32BufferAttribute(colors3, 3));
	geometry.computeVertexNormals();
	const body = new Mesh(
		geometry,
		new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
	);
	return {
		object: body,
		live(seconds) {
			body.rotation.y = (seconds / (SPIN * 1.5)) * Math.PI * 2;
		}
	};
}

function probe(colors: Palette, kit: Kit): Body {
	const craft = new Group();
	// The dish: a real paraboloid, pale outside, deep in the bowl.
	const profile = Array.from({ length: 12 }, (_, step) => {
		const r = (step / 11) * 0.98;
		return new Vector2(r, r * r * 0.45);
	});
	const outside = new Mesh(
		new LatheGeometry(profile, 32),
		new MeshStandardMaterial({ color: colors.pale, side: BackSide, metalness: 0.3 })
	);
	const inside = new Mesh(
		new LatheGeometry(profile, 32),
		new MeshStandardMaterial({ color: colors.deep, side: FrontSide, roughness: 0.4 })
	);
	const dish = new Group();
	dish.add(outside, inside);
	const feedStrut = new Mesh(new CylinderGeometry(0.03, 0.03, 0.5, 6), standard(colors.pale));
	feedStrut.position.y = 0.25;
	const feed = new Mesh(new SphereGeometry(0.13, 12, 8), standard(colors.pale));
	feed.position.y = 0.5;
	dish.add(feedStrut, feed);
	dish.position.set(-0.35, 0.3, 0);
	dish.rotation.z = (38 * Math.PI) / 180;

	const strut = new Mesh(new CylinderGeometry(0.06, 0.06, 0.9, 8), standard(colors.pale));
	strut.position.set(0.1, -0.15, 0);
	strut.rotation.z = Math.PI / 4;
	const hull = new Mesh(
		new BoxGeometry(0.9, 0.78, 0.7),
		standard(colors.lit.clone().lerp(colors.pale, 0.5), { metalness: 0.3, roughness: 0.55 })
	);
	hull.position.set(0.5, -0.55, 0);
	const panel = new Mesh(
		new BoxGeometry(0.78, 0.44, 0.04),
		new MeshStandardMaterial({ map: panelTexture(kit, colors), metalness: 0.4, roughness: 0.35 })
	);
	panel.position.set(1.34, -0.5, 0);
	const light = beacon();
	light.scale.setScalar(0.6);
	light.position.set(0.5, -0.1, 0.2);
	craft.add(dish, strut, hull, panel, light);

	return {
		object: craft,
		live(seconds) {
			craft.rotation.z = (swing(seconds, SPIN * 0.7) * (7 * Math.PI)) / 180;
			craft.rotation.y = -seconds * 0.2;
			blink(light, seconds);
		}
	};
}

/* -------------------------------------------------------------------------- *
 * Planets
 * -------------------------------------------------------------------------- */

/** The dial's bands, wrapped round a sphere: pale and dark lanes with a wobble to their edges. */
function bandTexture(kit: Kit, colors: Palette, spot: boolean): Texture {
	return kit.texture(`bands-${colors.key}-${spot}`, [256, 128], (g) => {
		g.fillStyle = css(colors.lit);
		g.fillRect(0, 0, 256, 128);
		const lanes: [number, number, Color, number][] = [
			[-0.62, 0.2, colors.pale, 0.85],
			[-0.22, 0.17, colors.deep, 0.6],
			[0.16, 0.24, colors.pale, 0.8],
			[0.58, 0.15, colors.deep, 0.6],
			[-0.85, 0.08, colors.deep, 0.45],
			[0.36, 0.06, colors.deep, 0.45]
		];
		for (const [centre, half, color, alpha] of lanes) {
			g.fillStyle = css(color);
			g.globalAlpha = alpha;
			g.beginPath();
			for (let x = 0; x <= 256; x += 4) {
				const wobble = Math.sin(x / 13 + centre * 9) * 1.6;
				g.lineTo(x, 64 + (centre - half) * 60 + wobble);
			}
			for (let x = 256; x >= 0; x -= 4) {
				const wobble = Math.sin(x / 11 + centre * 5) * 1.6;
				g.lineTo(x, 64 + (centre + half) * 60 + wobble);
			}
			g.fill();
		}
		if (spot) {
			g.globalAlpha = 0.8;
			g.fillStyle = css(colors.pale);
			g.beginPath();
			g.ellipse(84, 76, 18, 7, 0, 0, Math.PI * 2);
			g.fill();
			g.globalAlpha = 0.5;
			g.fillStyle = css(colors.deep);
			g.beginPath();
			g.ellipse(84, 76, 9, 3.5, 0, 0, Math.PI * 2);
			g.fill();
		}
		g.globalAlpha = 1;
	});
}

/** The ice world's caps and seas. */
function iceTexture(kit: Kit, colors: Palette): Texture {
	return kit.texture(`ice-${colors.key}`, [256, 128], (g) => {
		g.fillStyle = css(colors.lit);
		g.fillRect(0, 0, 256, 128);
		g.fillStyle = css(colors.deep);
		for (const [x, y, rx, ry, alpha] of [
			[70, 70, 34, 16, 0.55],
			[170, 60, 26, 12, 0.5],
			[210, 84, 18, 9, 0.4],
			[30, 86, 16, 8, 0.4]
		]) {
			g.globalAlpha = alpha;
			g.beginPath();
			g.ellipse(x, y, rx, ry, 0.3, 0, Math.PI * 2);
			g.fill();
		}
		g.fillStyle = '#f2f6ff';
		g.globalAlpha = 0.92;
		g.beginPath();
		g.moveTo(0, 0);
		for (let x = 0; x <= 256; x += 8) g.lineTo(x, 20 + Math.sin(x / 17) * 4);
		g.lineTo(256, 0);
		g.fill();
		g.globalAlpha = 0.75;
		g.beginPath();
		g.moveTo(0, 128);
		for (let x = 0; x <= 256; x += 8) g.lineTo(x, 114 + Math.sin(x / 21) * 3);
		g.lineTo(256, 128);
		g.fill();
		g.globalAlpha = 1;
	});
}

/** A ring's lanes, drawn as circles: `RingGeometry`'s UVs are planar, so a round texture fits it. */
function ringTexture(kit: Kit, colors: Palette): Texture {
	return kit.texture(`ring-${colors.key}`, [256, 256], (g) => {
		const inner = (1.15 / 1.7) * 128;
		for (let r = inner; r < 128; r += 1) {
			const t = (r - inner) / (128 - inner);
			const lane = 0.55 + 0.45 * Math.sin(t * 19) * Math.sin(t * 7 + 1);
			g.strokeStyle = css(colors.pale);
			g.globalAlpha = Math.max(0, lane) * (t < 0.08 || t > 0.94 ? 0.3 : 0.85);
			g.beginPath();
			g.arc(128, 128, r, 0, Math.PI * 2);
			g.stroke();
		}
		g.globalAlpha = 1;
	});
}

function world(radius: number, map: Texture, colors: Palette, roughness: number): Group {
	const world = new Group();
	world.add(
		new Mesh(
			new SphereGeometry(radius, 48, 32),
			new MeshStandardMaterial({ map, roughness, metalness: 0 })
		)
	);
	// An atmosphere: a thin shell seen from behind, lit at the limb.
	world.add(
		new Mesh(
			new SphereGeometry(radius * 1.07, 48, 32),
			new MeshBasicMaterial({
				color: colors.pale,
				side: BackSide,
				transparent: true,
				opacity: 0.22,
				blending: AdditiveBlending,
				depthWrite: false
			})
		)
	);
	return world;
}

function planet(variant: number, colors: Palette, kit: Kit): Body {
	const body = new Group();
	// A world's axis leans, as every world's does.
	body.rotation.z = (-17 * Math.PI) / 180;
	const globe =
		variant === 2
			? world(1, iceTexture(kit, colors), colors, 0.5)
			: world(variant === 1 ? 0.82 : 1, bandTexture(kit, colors, variant === 0), colors, 0.85);
	body.add(globe);

	if (variant === 1) {
		const ring = new Mesh(
			new RingGeometry(1.15, 1.7, 96),
			new MeshBasicMaterial({
				map: ringTexture(kit, colors),
				transparent: true,
				side: DoubleSide,
				depthWrite: false
			})
		);
		ring.rotation.x = Math.PI / 2 - 0.28;
		body.add(ring);
	}

	return {
		object: body,
		live(seconds) {
			globe.rotation.y = (seconds / (SPIN * 1.6)) * Math.PI * 2;
		}
	};
}

/* -------------------------------------------------------------------------- *
 * Star systems
 * -------------------------------------------------------------------------- */

interface Star {
	group: Group;
	flare: Sprite;
}

function star(kit: Kit, colors: Palette, core: number, dim = false): Star {
	const group = new Group();
	group.add(
		new Mesh(
			new SphereGeometry(core, 32, 16),
			new MeshBasicMaterial({ color: dim ? colors.pale : new Color('#fffdf2') })
		)
	);
	group.add(aura(kit, colors.lit, core * 5.5, 0.55));
	const flare = aura(kit, colors.lit, core * 8, 0.9, kit.flare());
	group.add(flare);
	return { group, flare };
}

/** The dial's flare: breathing between 92% and 106%, turning an eighth and back. */
function flareAt(flare: Sprite, base: number, seconds: number, delay = 0): void {
	const phase = (swing(seconds - delay, 4.5) + 1) / 2;
	flare.scale.setScalar(base * (0.92 + 0.14 * phase));
	const material = flare.material as SpriteMaterial;
	material.rotation = (phase * Math.PI) / 4;
	material.opacity = 0.75 + 0.25 * phase;
}

function orbitRing(radius: number, colors: Palette): Mesh {
	const ring = new Mesh(
		new TorusGeometry(radius, 0.012, 6, 96),
		new MeshBasicMaterial({ color: colors.pale, transparent: true, opacity: 0.55 })
	);
	ring.rotation.x = Math.PI / 2;
	return ring;
}

function ringedWorld(radius: number, colors: Palette): Group {
	const world = new Group();
	world.add(new Mesh(new SphereGeometry(radius, 20, 12), standard(colors.pale)));
	const ring = new Mesh(
		new TorusGeometry(radius * 1.6, radius * 0.08, 6, 48),
		new MeshBasicMaterial({ color: colors.pale, transparent: true, opacity: 0.8 })
	);
	ring.rotation.x = Math.PI / 2 - 0.35;
	world.add(ring);
	return world;
}

function starSystem(variant: number, colors: Palette, kit: Kit): Body {
	const system = new Group();

	if (variant === 1) {
		// A binary pair, round a centre neither of them sits on.
		system.add(aura(kit, colors.lit, 2.6, 0.18));
		const pair = new Group();
		const bright = star(kit, colors, 0.34);
		bright.group.position.x = -0.52;
		const dim = star(kit, colors, 0.22, true);
		dim.group.position.x = 0.66;
		pair.add(bright.group, dim.group);
		system.add(pair);
		return {
			object: system,
			live(seconds) {
				pair.rotation.y = (seconds / (SPIN * 0.9)) * Math.PI * 2;
				flareAt(bright.flare, 0.34 * 8, seconds);
				flareAt(dim.flare, 0.22 * 8, seconds, 1.4);
			}
		};
	}

	const sun = star(kit, colors, 0.38);
	system.add(sun.group);

	if (variant === 2) {
		// One star, one big world, one tilted orbit.
		const plane = new Group();
		plane.rotation.set(0.5, 0, (-22 * Math.PI) / 180);
		plane.add(orbitRing(1.3, colors));
		const carrier = new Group();
		const big = ringedWorld(0.24, colors);
		big.position.x = 1.3;
		carrier.add(big);
		plane.add(carrier);
		system.add(plane);
		return {
			object: system,
			live(seconds) {
				carrier.rotation.y = -(seconds / (SPIN * 0.9)) * Math.PI * 2;
				flareAt(sun.flare, 0.38 * 8, seconds);
			}
		};
	}

	// A star with worlds of its own, on rings it keeps.
	const plane = new Group();
	plane.rotation.x = 0.35;
	plane.add(orbitRing(0.74, colors), orbitRing(1.18, colors));
	const inner = new Group();
	const small = new Mesh(new SphereGeometry(0.13, 16, 10), standard(colors.pale));
	small.position.x = 0.74;
	inner.add(small);
	const outer = new Group();
	const ringed = ringedWorld(0.17, colors);
	ringed.position.x = -1.18;
	outer.add(ringed);
	plane.add(inner, outer);
	system.add(plane);
	return {
		object: system,
		live(seconds) {
			inner.rotation.y = -(seconds / (SPIN * 0.55)) * Math.PI * 2;
			outer.rotation.y = (seconds / SPIN) * Math.PI * 2;
			flareAt(sun.flare, 0.38 * 8, seconds);
		}
	};
}

/* -------------------------------------------------------------------------- *
 * Galaxies and universes: sized by extent, not body radius
 * -------------------------------------------------------------------------- */

/** Stars, each its own colour, in pixels so a galaxy stays a galaxy at any distance. */
function cloud(
	positions: number[],
	colors: number[],
	pixels: number,
	pixelRatio: number,
	opacity: number,
	kit: Kit
): Points {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
	return new Points(
		geometry,
		new PointsMaterial({
			vertexColors: true,
			// Round and soft, not the square a bare point is: each star a glow.
			map: kit.glow,
			size: pixels * pixelRatio,
			sizeAttenuation: false,
			transparent: true,
			opacity,
			depthWrite: false,
			blending: AdditiveBlending
		})
	);
}

/** A point's normal-ish scatter, from two uniform draws. */
function gauss(random: () => number): number {
	return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-6))) * Math.cos(Math.PI * 2 * random());
}

/** The dial's arms: logarithmic spirals, `r = start · e^(0.46θ)`. */
function armPoint(start: number, along: number, offset: number): [number, number] {
	const radius = start * Math.exp(0.46 * along);
	return [Math.cos(along + offset) * radius, Math.sin(along + offset) * radius];
}

export function galaxyDisc(
	variant: number,
	extent: number,
	colors: Palette,
	seed: string,
	pixelRatio: number,
	kit: Kit
): Body {
	const random = seeded(hash(`${seed}galaxy`));
	const positions: number[] = [];
	const tints: number[] = [];
	const white = new Color('#ffffff');
	const push = (x: number, y: number, z: number, heat: number) => {
		positions.push(x, y, z);
		// Old light near the core runs white; the arms carry the goal's colour.
		const tone = colors.lit
			.clone()
			.lerp(colors.pale, 0.35)
			.lerp(white, heat * 0.6);
		tints.push(tone.r, tone.g, tone.b);
	};

	if (variant === 2) {
		// Elliptical: no arms, a great deal of old light, thickest in the middle.
		for (let index = 0; index < 3400; index += 1) {
			const x = gauss(random) * 0.42;
			const y = gauss(random) * 0.2;
			const z = gauss(random) * 0.3;
			const r = Math.hypot(x, y, z);
			push(x * extent, y * extent, z * extent, Math.max(0, 0.9 - r * 1.8));
		}
	} else {
		const barred = variant === 1;
		const start = barred ? 0.62 : 0.24;
		const sweep = barred ? 1.2 : 2.9;
		const reach = start * Math.exp(0.46 * sweep);
		const scale = extent / reach;
		for (let index = 0; index < 4200; index += 1) {
			const arm = index % 2;
			const along = Math.pow(random(), 0.75) * sweep;
			const [ax, az] = armPoint(start, along, arm * Math.PI);
			const radius = Math.hypot(ax, az);
			// Tight enough that the arms read as arms, as the dial's stroked ones do.
			const spread = 0.015 + radius * 0.045;
			push(
				(ax + gauss(random) * spread) * scale,
				gauss(random) * 0.025 * extent,
				(az + gauss(random) * spread) * scale,
				Math.max(0, 0.7 - (radius / reach) * 1.4)
			);
		}
		if (barred) {
			// The bar the arms leave from.
			for (let index = 0; index < 900; index += 1) {
				const x = (random() * 2 - 1) * 0.66;
				push(
					x * scale,
					gauss(random) * 0.02 * extent,
					gauss(random) * 0.08 * scale,
					0.55 - Math.abs(x) * 0.4
				);
			}
		}
		// A faint halo round the whole disc.
		for (let index = 0; index < 350; index += 1) {
			const angle = random() * Math.PI * 2;
			const r = Math.sqrt(random()) * extent * 0.95;
			push(Math.cos(angle) * r, gauss(random) * 0.03 * extent, Math.sin(angle) * r, 0);
		}
		// The bulge.
		for (let index = 0; index < 500; index += 1) {
			push(
				gauss(random) * 0.07 * extent,
				gauss(random) * 0.04 * extent,
				gauss(random) * 0.07 * extent,
				0.9
			);
		}
	}

	const disc = new Group();
	disc.add(cloud(positions, tints, 3.2, pixelRatio, 0.55, kit));
	if (variant === 2) disc.rotation.z = (-24 * Math.PI) / 180;
	const period = variant === 2 ? SPIN * 4 * 6 : SPIN * 1.5 * 6;
	return {
		object: disc,
		live(seconds) {
			disc.rotation.y = -(seconds / period) * Math.PI * 2;
		}
	};
}

export function universeInterior(
	variant: number,
	extent: number,
	colors: Palette,
	seed: string,
	pixelRatio: number,
	kit: Kit
): Body {
	const random = seeded(hash(`${seed}universe`));
	const inside = new Group();
	const inSphere = (radius: number) => {
		const direction = new Vector3(gauss(random), gauss(random), gauss(random)).normalize();
		return direction.multiplyScalar(Math.cbrt(random()) * radius);
	};

	// Far stars, everywhere inside it.
	const positions: number[] = [];
	const tints: number[] = [];
	for (let index = 0; index < 700; index += 1) {
		const at = inSphere(extent * 0.85);
		positions.push(at.x, at.y, at.z);
		const tone = new Color('#ffffff').lerp(colors.pale, random() * 0.5);
		tints.push(tone.r, tone.g, tone.b);
	}
	const stars = cloud(positions, tints, 2.6, pixelRatio, 0.9, kit);
	inside.add(stars);

	if (variant === 1) {
		// A nebula: light with something in the way of it, in depth.
		for (const [x, y, z, size, color, opacity] of [
			[-0.26, 0.2, 0.1, 1.1, colors.lit, 0.4],
			[0.32, -0.28, -0.15, 0.85, colors.pale, 0.28],
			[0.02, 0, 0.05, 0.55, colors.pale, 0.45],
			[-0.1, -0.2, 0.35, 0.7, colors.lit, 0.25],
			[0.25, 0.25, -0.3, 0.6, colors.deep, 0.5]
		] as const) {
			const puff = aura(kit, color, size * extent * 1.6, opacity);
			puff.position.set(x * extent, y * extent, z * extent);
			inside.add(puff);
		}
	} else if (variant === 2) {
		// The cosmic web: bright nodes and the threads they hang on.
		const nodes = Array.from({ length: 12 }, () => inSphere(extent * 0.7));
		const threads: number[] = [];
		for (const [index, node] of nodes.entries()) {
			const nearest = nodes
				.map((other, at) => ({ at, d: other.distanceTo(node) }))
				.filter((candidate) => candidate.at !== index)
				.sort((a, b) => a.d - b.d)
				.slice(0, 2);
			for (const { at } of nearest) threads.push(...node.toArray(), ...nodes[at].toArray());
			const knot = aura(kit, colors.pale, extent * (index % 3 === 0 ? 0.16 : 0.1), 0.7);
			knot.position.copy(node);
			inside.add(knot);
		}
		inside.add(filaments(threads, colors));
	} else {
		// Haze: the universe's own light, filling it.
		inside.add(aura(kit, colors.lit, extent * 2.2, 0.16));
		inside.add(aura(kit, colors.pale, extent * 1.1, 0.12));
	}

	const material = stars.material as PointsMaterial;
	return {
		object: inside,
		live(seconds) {
			inside.rotation.y = (seconds / (SPIN * 12)) * Math.PI * 2;
			// The far stars breathe together, the dial's twinkle stretched out.
			material.opacity = 0.7 + 0.3 * swing(seconds, 4.5);
		}
	};
}

/** One-pixel threads: `LineSegments` is the thinnest line WebGL draws, which is a filament's width. */
function filaments(points: number[], colors: Palette): Object3D {
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
	return new LineSegments(
		geometry,
		new LineBasicMaterial({
			color: colors.pale,
			transparent: true,
			opacity: 0.55,
			blending: AdditiveBlending,
			depthWrite: false
		})
	);
}

/* -------------------------------------------------------------------------- */

/**
 * A goal's body at unit size, for the tiers whose body is a thing you could
 * hold rather than a region: satellites, planets and star systems. The caller
 * scales it by `bodyRadius`.
 */
export function goalBody(
	tier: Tier,
	variant: number,
	colors: Palette,
	seed: string,
	kit: Kit
): Body | null {
	switch (tier) {
		case 'satellite':
			return variant === 1
				? moon(colors, seed)
				: variant === 2
					? probe(colors, kit)
					: comsat(colors, kit);
		case 'planet':
			return planet(variant, colors, kit);
		case 'starSystem':
			return starSystem(variant, colors, kit);
		default:
			return null;
	}
}

/** The heart of a galaxy or universe goal: a bright core at body size. */
export function core(colors: Palette, kit: Kit, radius: number): Object3D {
	const group = new Group();
	group.add(
		new Mesh(new SphereGeometry(radius * 0.35, 24, 16), new MeshBasicMaterial({ color: '#fffdf2' }))
	);
	group.add(aura(kit, colors.pale, radius * 3, 0.7));
	group.add(aura(kit, colors.lit, radius * 7, 0.35));
	return group;
}
