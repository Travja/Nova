/**
 * WCAG contrast, as arithmetic over plain colours.
 *
 * Nova is light text on near-black panels, and several of those panels are
 * translucent — a label's real background is the surface composited over the
 * void behind it, not the colour written in the token. Working that out by eye
 * is how #7 ended up unsure whether `--text-dim` cleared the line, so it is
 * done here instead and asserted in `contrast.test.ts`.
 */

export type Rgb = readonly [number, number, number];

/** `#rrggbb`, the only form the palette is written in. */
export function parseHex(hex: string): Rgb {
	const match = /^#([\da-f]{6})$/i.exec(hex.trim());
	if (!match) throw new Error(`not a six-digit hex colour: ${hex}`);
	const value = Number.parseInt(match[1], 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** What `rgba(r, g, b, a)` over `behind` actually paints. */
export function composite(colour: Rgb, alpha: number, behind: Rgb): Rgb {
	return [0, 1, 2].map((i) => alpha * colour[i] + (1 - alpha) * behind[i]) as unknown as Rgb;
}

function channelLuminance(value: number): number {
	const c = value / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, per WCAG 2.x. */
export function luminance([r, g, b]: Rgb): number {
	return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** The contrast ratio between two colours, from 1:1 to 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Normal body text has to clear this, whatever size it is set at. */
export const AA_NORMAL_TEXT = 4.5;
