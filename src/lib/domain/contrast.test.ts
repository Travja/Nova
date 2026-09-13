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

/** Pull a `--token: #rrggbb;` straight out of the stylesheet. */
function token(name: string): Rgb {
	const match = new RegExp(`--${name}:\\s*(#[\\da-f]{6})\\s*;`, 'i').exec(APP_CSS);
	if (!match) throw new Error(`--${name} is not declared in app.css as a hex colour`);
	return parseHex(match[1]);
}

const VOID = token('space-void');

/**
 * The grounds text is actually read on.
 *
 * The two surfaces are translucent, so what a label sits on is the surface
 * composited over the void, which is lighter than the token suggests and is the
 * ground the ratios below are measured against. The chip and input fills are
 * written as literal `rgba()` in `app.css` and in `GoalCard`, and sit on a
 * panel rather than on the page.
 */
const SURFACE = composite(parseHex('#161d3d'), 0.72, VOID);
const SURFACE_STRONG = composite(parseHex('#1c244a'), 0.92, VOID);
const CHIP = composite([10, 14, 36], 0.8, SURFACE);
const INPUT = composite([6, 9, 26], 0.72, SURFACE);

const GROUNDS = {
	'space-void': VOID,
	'space-surface': SURFACE,
	'space-surface-strong': SURFACE_STRONG,
	'chip fill': CHIP,
	'input fill': INPUT
} as const;

describe('the contrast arithmetic', () => {
	it('puts black on white at 21:1', () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
	});

	it('is symmetric', () => {
		const a = parseHex('#8b95bf');
		const b = SURFACE;
		expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
	});

	it('composites towards the colour behind it', () => {
		expect(composite([255, 255, 255], 0.5, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
		expect(composite([255, 255, 255], 1, [0, 0, 0])).toEqual([255, 255, 255]);
	});

	it('reads a translucent surface as lighter than its own token', () => {
		expect(luminance(SURFACE)).toBeGreaterThan(luminance(VOID));
	});

	it('rejects a colour it cannot read', () => {
		expect(() => parseHex('#fff')).toThrow();
	});
});

/**
 * #7 flagged `--text-dim` on `--space-surface` as close to the line, and #32
 * shrinks secondary text — which is set in that very token — across the app.
 * A ratio does not move with font size, but the margin here is small enough
 * that it should not be left to anyone's eye again.
 */
describe('every ink Nova sets text in', () => {
	const INKS = ['text', 'text-bright', 'text-dim', 'accent', 'accent-warm', 'success', 'danger'];

	for (const ink of INKS) {
		for (const [groundName, ground] of Object.entries(GROUNDS)) {
			it(`--${ink} on ${groundName} clears AA for normal text`, () => {
				expect(contrastRatio(token(ink), ground)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
			});
		}
	}
});

describe('the tier accents, which are set as text on pills and headings', () => {
	for (const tier of TIER_LIST) {
		it(`${tier.label} clears AA on every surface`, () => {
			for (const ground of Object.values(GROUNDS)) {
				expect(
					contrastRatio(parseHex(TIER_DEFINITIONS[tier.id].accent), ground)
				).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
			}
		});
	}
});
