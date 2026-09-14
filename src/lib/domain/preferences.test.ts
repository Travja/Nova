import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	DEFAULT_PREFERENCES,
	MIN_DIAL_SCALE,
	PREFERENCE_KEYS,
	PREFERENCE_SPECS,
	mergePreferences,
	preferenceAttributeString,
	preferenceAttributes,
	readPreferences,
	specFor,
	writePreferences
} from './preferences';

const APP_CSS = readFileSync('src/lib/styles/app.css', 'utf8');

describe('reading a stored blob', () => {
	it('falls back to the defaults for a row that has never been written', () => {
		expect(readPreferences(null)).toEqual(DEFAULT_PREFERENCES);
		expect(readPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
		expect(readPreferences('')).toEqual(DEFAULT_PREFERENCES);
	});

	it('keeps a stored value this build still offers', () => {
		expect(readPreferences('{"density":"compact"}').density).toBe('compact');
	});

	it('ignores anything it cannot render', () => {
		// Malformed JSON, the wrong type, and a value withdrawn since it was
		// written all have to land on the default rather than on `<html>`, which
		// has no CSS for them.
		expect(readPreferences('not json').density).toBe('default');
		expect(readPreferences('[]').density).toBe('default');
		expect(readPreferences('{"density":7}').density).toBe('default');
		expect(readPreferences('{"density":"spacious"}').density).toBe('default');
	});

	it('drops a preference this build no longer knows about', () => {
		const stored = writePreferences({ ...DEFAULT_PREFERENCES, density: 'compact' });
		const withExtra = JSON.stringify({ ...JSON.parse(stored), wallpaper: 'nebula' });
		expect(readPreferences(withExtra)).toEqual({ ...DEFAULT_PREFERENCES, density: 'compact' });
	});

	it('round-trips through storage', () => {
		const preferences = { ...DEFAULT_PREFERENCES, density: 'compact' } as const;
		expect(readPreferences(writePreferences(preferences))).toEqual(preferences);
	});
});

describe('merging a submitted form', () => {
	it('takes a valid submitted value', () => {
		expect(mergePreferences(DEFAULT_PREFERENCES, { density: 'compact' }).density).toBe('compact');
	});

	it('leaves a preference the form omitted alone', () => {
		const stored = { ...DEFAULT_PREFERENCES, density: 'compact' } as const;
		expect(mergePreferences(stored, {})).toEqual(stored);
	});

	it('refuses a value that is not on offer rather than storing it', () => {
		const stored = { ...DEFAULT_PREFERENCES, density: 'compact' } as const;
		expect(mergePreferences(stored, { density: 'tiny' })).toEqual(stored);
	});
});

describe('reaching the page', () => {
	it('names an attribute per preference', () => {
		expect(preferenceAttributes({ ...DEFAULT_PREFERENCES, density: 'compact' })).toEqual({
			...preferenceAttributes(DEFAULT_PREFERENCES),
			'data-density': 'compact'
		});
	});

	it('renders attributes for the html tag', () => {
		expect(preferenceAttributeString(DEFAULT_PREFERENCES)).toContain('data-density="default"');
	});

	it('has a block of CSS behind every non-default value', () => {
		// A value with no rules behind it is a control that does nothing.
		for (const key of PREFERENCE_KEYS) {
			const spec = PREFERENCE_SPECS[key];
			for (const value of spec.values.slice(1)) {
				expect(APP_CSS, `${key}: ${value} has no block in app.css`).toContain(
					`[${spec.attribute}='${value}']`
				);
			}
		}
	});

	it('labels every value it offers', () => {
		for (const key of PREFERENCE_KEYS) {
			const spec = specFor(key);
			for (const value of spec.values) {
				expect(spec.options[value], `${key}: ${value} has no label`).toBeTruthy();
			}
		}
	});
});

describe('the density tokens in app.css', () => {
	/** Every value `--dial-scale` is given, in any density block. */
	function dialScales(): number[] {
		return [...APP_CSS.matchAll(/--dial-scale:\s*([\d.]+)\s*;/g)].map((match) => Number(match[1]));
	}

	it('declares a dial scale', () => {
		expect(dialScales().length).toBeGreaterThan(0);
	});

	it('never shrinks a dial past the size OrbitDial judged its bodies at', () => {
		// `OrbitDial` drops a body to its silhouette below roughly 11px across,
		// and measures against `MIN_DIAL_SCALE` because it cannot read the CSS
		// that actually sizes it. Take the scale below that and bodies start
		// rendering detail at sizes too small to carry it.
		for (const scale of dialScales()) {
			expect(scale).toBeGreaterThanOrEqual(MIN_DIAL_SCALE);
		}
	});

	it('keeps the touch floor at 44px in every density', () => {
		// The whole point of the floor: compact buys space from padding and type,
		// never from the size of a control. `--tap-min` is declared once and no
		// density block may restate it.
		const declarations = [...APP_CSS.matchAll(/--tap-min:\s*([^;]+);/g)].map((match) =>
			match[1].trim()
		);
		expect(declarations).toEqual(['2.75rem']);
	});
});
