/**
 * A rough, deliberately dumb reading of a user-agent string.
 *
 * The session list needs enough for someone to recognise their own devices —
 * "Firefox on Windows" — and nothing more. User-agent parsing is a bottomless
 * pit, so this stops at the families a person is likely to be signed in from
 * and calls everything else unknown rather than guessing.
 */

const BROWSERS: [RegExp, string][] = [
	[/\bEdg[A-Za-z]*\//, 'Edge'],
	[/\bOPR\/|\bOpera\b/, 'Opera'],
	[/\bSamsungBrowser\//, 'Samsung Internet'],
	[/\bFirefox\/|\bFxiOS\//, 'Firefox'],
	[/\bCriOS\//, 'Chrome'],
	[/\bChrome\//, 'Chrome'],
	[/\bSafari\//, 'Safari']
];

const PLATFORMS: [RegExp, string][] = [
	[/\biPhone\b/, 'iPhone'],
	[/\biPad\b/, 'iPad'],
	[/\bAndroid\b/, 'Android'],
	[/\bWindows\b/, 'Windows'],
	[/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
	[/\bCrOS\b/, 'ChromeOS'],
	[/\bLinux\b/, 'Linux']
];

function match(pairs: [RegExp, string][], value: string): string | null {
	for (const [pattern, name] of pairs) if (pattern.test(value)) return name;
	return null;
}

export const UNKNOWN_DEVICE = 'Unknown device';

export function describeDevice(userAgent: string | null | undefined): string {
	if (!userAgent) return UNKNOWN_DEVICE;

	const browser = match(BROWSERS, userAgent);
	const platform = match(PLATFORMS, userAgent);

	if (browser && platform) return `${browser} on ${platform}`;
	return browser ?? platform ?? UNKNOWN_DEVICE;
}
