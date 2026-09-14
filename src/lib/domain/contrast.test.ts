import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	AA_NORMAL_TEXT,
	composite,
	contrastRatio,
	luminance,
	parseHex,
	type Rgb
} from './contrast';
import { TIER_DEFINITIONS, TIER_LIST } from './tiers';

const APP_CSS = readFileSync('src/lib/styles/app.css', 'utf8');

/**
 * The body of one selector's block, so a token can be read from the palette it
 * belongs to.
 *
 * This used to scan the whole stylesheet for `--token: #rrggbb`, which found
 * whichever declaration came first — always the default palette's. #14 shipped
 * a second one under `[data-contrast='high']` and claimed its ratios without
 * anything measuring them, and that is exactly the shape of thing that only
 * gets caught if the test can see both blocks apart.
 */
function block(selector: string): string {
	const start = APP_CSS.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`${selector} is not a block in app.css`);
	const end = APP_CSS.indexOf('}', start);
	return APP_CSS.slice(start, end);
}

const ROOT = block(':root');
const HIGH_CONTRAST = block(":root[data-contrast='high']");

/** Pull a `--token: #rrggbb;` out of one block. */
function tokenIn(source: string, name: string): Rgb {
	const match = new RegExp(`--${name}:\\s*(#[\\da-f]{6})\\s*;`, 'i').exec(source);
	if (!match) throw new Error(`--${name} is not declared as a hex colour in that block`);
	return parseHex(match[1]);
}

/** A token as the high-contrast palette paints it, falling back to the default. */
function highToken(name: string): Rgb {
	return new RegExp(`--${name}:\\s*#`, 'i').test(HIGH_CONTRAST)
		? tokenIn(HIGH_CONTRAST, name)
		: tokenIn(ROOT, name);
}

const VOID = tokenIn(ROOT, 'space-void');

/**
 * The sky a translucent panel is actually read against.
 *
 * `--space-void` is the page's own background and the darkest thing behind a
 * panel, which makes it the flattering ground rather than the honest one.
 * `Starfield` paints over it: a gradient up to `#16204d` at the top of the
 * screen, and a violet nebula blob on top of that. The nebula core is the
 * lightest large area anywhere behind a panel, so it is the one worth measuring
 * — the stars themselves are 2.7px at most under a 14px backdrop blur, which
 * spreads one into well under a percent of white and cannot move a ratio.
 */
const SKY_TOP = parseHex('#16204d');
const NEBULA_CORE = composite(parseHex('#7c5cf0'), 0.3, SKY_TOP);

/**
 * Every ground text is set on, for one palette.
 *
 * The surfaces are translucent, so what a label sits on is the surface
 * composited over whatever is behind it. The chip, input, tier-option and
 * reorder-row fills are written as literal `rgba()` in `app.css` and in the
 * components, and sit on a panel rather than on the page; a compact row's sheet
 * stacks two surfaces, which lands lighter than either pair on its own.
 */
function groundsFor(
	surfaceHex: string,
	surfaceAlpha: number,
	strongHex: string,
	strongAlpha: number
) {
	const surfaceOver = (behind: Rgb) => composite(parseHex(surfaceHex), surfaceAlpha, behind);
	const SURFACE = surfaceOver(VOID);
	const SURFACE_STRONG = composite(parseHex(strongHex), strongAlpha, VOID);
	const CARD_ON_SHEET = composite(parseHex(surfaceHex), surfaceAlpha, SURFACE_STRONG);

	return {
		'space-void': VOID,
		'space-surface': SURFACE,
		'space-surface-strong': SURFACE_STRONG,
		'a panel over the sky gradient': surfaceOver(SKY_TOP),
		'a panel over the nebula': surfaceOver(NEBULA_CORE),
		'chip fill': composite([10, 14, 36], 0.8, SURFACE),
		'input fill': composite([6, 9, 26], 0.72, SURFACE),
		'tier-option fill': composite([6, 9, 26], 0.55, SURFACE),
		'reorder row fill': composite([10, 14, 36], 0.55, SURFACE),
		'the "this device" badge': composite([167, 139, 250], 0.18, SURFACE),
		'card on a sheet': CARD_ON_SHEET,
		'chip on a sheet': composite([10, 14, 36], 0.8, CARD_ON_SHEET)
	};
}

/** Every ink Nova sets text in, and how each palette paints it. */
const INKS = ['text', 'text-bright', 'text-dim', 'accent', 'accent-warm', 'success', 'danger'];

const PALETTES = {
	default: {
		grounds: groundsFor('#161d3d', 0.72, '#1c244a', 0.92),
		ink: (name: string) => tokenIn(ROOT, name)
	},
	'high contrast': {
		// `[data-contrast='high']` restates the surfaces as near-opaque, which is
		// most of what it buys: the sky barely reaches through them at all.
		grounds: groundsFor('#080a16', 0.94, '#0a0c1a', 0.98),
		ink: highToken
	}
} as const;

describe('the contrast arithmetic', () => {
	it('puts black on white at 21:1', () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
	});

	it('is symmetric', () => {
		const a = parseHex('#8b95bf');
		const b = PALETTES.default.grounds['space-surface'];
		expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
	});

	it('composites towards the colour behind it', () => {
		expect(composite([255, 255, 255], 0.5, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
		expect(composite([255, 255, 255], 1, [0, 0, 0])).toEqual([255, 255, 255]);
	});

	it('reads a translucent surface as lighter than its own token', () => {
		expect(luminance(PALETTES.default.grounds['space-surface'])).toBeGreaterThan(luminance(VOID));
	});

	it('rejects a colour it cannot read', () => {
		expect(() => parseHex('#fff')).toThrow();
	});

	it('reads the two palettes apart rather than finding the first hex in the file', () => {
		expect(tokenIn(ROOT, 'text-dim')).not.toEqual(highToken('text-dim'));
	});
});

/**
 * #7 flagged `--text-dim` on `--space-surface` as close to the line, and #32
 * shrinks secondary text — which is set in that very token — across the app.
 * A ratio does not move with font size, but the margin was small enough that it
 * should not be left to anyone's eye again.
 *
 * Measured, it is not close: 6.05:1 on a panel over the void and 5.07:1 on one
 * over the nebula, against a floor of 4.5. Both palettes clear AA on every
 * ground below, so the high-contrast option is an option rather than the excuse
 * for a default that does not meet the bar.
 */
describe('every ink Nova sets text in', () => {
	for (const [palette, { grounds, ink }] of Object.entries(PALETTES)) {
		for (const name of INKS) {
			for (const [groundName, ground] of Object.entries(grounds)) {
				it(`${palette}: --${name} on ${groundName} clears AA for normal text`, () => {
					expect(contrastRatio(ink(name), ground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
				});
			}
		}
	}
});

describe('the tier accents, which are set as text on pills and headings', () => {
	for (const [palette, { grounds }] of Object.entries(PALETTES)) {
		for (const tier of TIER_LIST) {
			it(`${palette}: ${tier.label} clears AA on every surface`, () => {
				for (const ground of Object.values(grounds)) {
					expect(
						contrastRatio(parseHex(TIER_DEFINITIONS[tier.id].accent), ground)
					).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
				}
			});
		}
	}
});

/**
 * The figures themselves, so the numbers in #7 are a thing the suite holds
 * rather than a thing somebody wrote down once.
 *
 * Each is the tightest pairing in its palette, and the two that #7 and #14
 * named specifically. They are asserted to a tenth: close enough to catch a
 * palette edit, loose enough not to break on a rounding difference.
 */
describe('the figures written down for both palettes', () => {
	const ratio = (palette: keyof typeof PALETTES, ink: string, ground: string) =>
		contrastRatio(
			PALETTES[palette].ink(ink),
			PALETTES[palette].grounds[ground as keyof ReturnType<typeof groundsFor>]
		);

	it('holds the default palette where #7 was unsure of it', () => {
		expect(ratio('default', 'text-dim', 'space-surface')).toBeCloseTo(6.05, 1);
		expect(ratio('default', 'text-dim', 'a panel over the nebula')).toBeCloseTo(5.07, 1);
		expect(ratio('default', 'text', 'space-surface')).toBeCloseTo(11.94, 1);
		expect(ratio('default', 'text-bright', 'space-surface')).toBeCloseTo(16.47, 1);
	});

	it('holds the high-contrast palette #14 claimed without measuring it', () => {
		// #14 said "text-dim is the tightest at ~14.2:1". The direction was right
		// and the number was conservative — but text-dim is not the tightest ink
		// in that palette. `--accent` is, and it is untouched by the high-contrast
		// block, which is the thing the claim missed.
		expect(ratio('high contrast', 'text-dim', 'space-surface')).toBeCloseTo(14.84, 1);
		expect(ratio('high contrast', 'accent', 'space-surface')).toBeCloseTo(7.26, 1);
		expect(ratio('high contrast', 'accent', 'the "this device" badge')).toBeCloseTo(5.65, 1);
	});

	it('makes high contrast an improvement on the default for every ink', () => {
		for (const name of INKS) {
			expect(ratio('high contrast', name, 'space-surface')).toBeGreaterThanOrEqual(
				ratio('default', name, 'space-surface')
			);
		}
	});
});
