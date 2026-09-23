import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

/**
 * The dial's own bodies, drawn into the universe.
 *
 * A goal's body in the universe is the same drawing its dial flies — the
 * `TierBody` silhouettes from #10, with the variant `bodyVariant` pins to the
 * goal and the goal's colour — rather than a second, 3D set that would drift
 * from the first. `Universe.svelte` renders each distinct body once, into a
 * hidden `<svg>`, and this turns that SVG into a texture for a billboard that
 * always faces the camera, as the flat drawing always faces the reader.
 *
 * The drawing is copied from the page, not re-described: every element's
 * computed paint is inlined so the SVG renders the same outside the page's
 * stylesheets, then it is drawn once into a canvas. Nothing is fetched and no
 * raster asset ships — the pixels are made here, from the components.
 */

/** Texture size in pixels. A body is rarely more than a few hundred pixels across on a phone. */
const SIZE = 256;

/** The paint the body components set in CSS, which an SVG loaded as an image cannot see. */
const PAINT = [
	'fill',
	'fill-opacity',
	'fill-rule',
	'stroke',
	'stroke-width',
	'stroke-opacity',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-dasharray',
	'opacity',
	'display',
	'visibility'
] as const;

function inlinePaint(source: Element, target: Element): void {
	const style = getComputedStyle(source);
	const declarations = PAINT.map((property) => `${property}:${style.getPropertyValue(property)}`);
	target.setAttribute('style', declarations.join(';'));
	target.removeAttribute('class');
	for (let index = 0; index < source.children.length; index += 1) {
		const child = target.children[index];
		if (child) inlinePaint(source.children[index], child);
	}
}

async function rasterize(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
	const copy = svg.cloneNode(true) as SVGSVGElement;
	inlinePaint(svg, copy);
	copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	copy.setAttribute('width', String(SIZE));
	copy.setAttribute('height', String(SIZE));
	copy.removeAttribute('style');

	const markup = new XMLSerializer().serializeToString(copy);
	const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
	try {
		const image = new Image(SIZE, SIZE);
		image.src = url;
		await image.decode();
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = SIZE;
		canvas.getContext('2d')?.drawImage(image, 0, 0, SIZE, SIZE);
		return canvas;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** One texture per distinct body, kept across rebuilds so a log does not redraw them all. */
export class BodyArt {
	private readonly textures = new Map<string, Texture>();

	constructor(
		/** The hidden SVG for a body, or null when the page has not drawn it. */
		private readonly source: (key: string) => SVGSVGElement | null,
		/** Called when a texture has its pixels, so the frame loop draws them. */
		private readonly onready: () => void
	) {}

	/**
	 * The texture for `key`, empty until its drawing has been rasterized — a
	 * frame or so after the first ask. Null when there is no drawing to use,
	 * and the caller draws nothing but the glow.
	 */
	texture(key: string): Texture | null {
		const known = this.textures.get(key);
		if (known) return known;
		const svg = this.source(key);
		if (!svg) return null;

		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = SIZE;
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		this.textures.set(key, texture);

		rasterize(svg)
			.then((drawn) => {
				texture.image = drawn;
				texture.needsUpdate = true;
				this.onready();
			})
			.catch(() => {
				// A body that cannot be drawn keeps its glow, which is still the
				// goal's colour at the goal's place: nothing is lost but the shape.
			});
		return texture;
	}

	/** Forget everything, for a context that has been lost and restored. */
	reset(): void {
		for (const texture of this.textures.values()) texture.needsUpdate = true;
	}

	dispose(): void {
		for (const texture of this.textures.values()) texture.dispose();
		this.textures.clear();
	}
}
