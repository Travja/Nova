/**
 * Account preferences: how Nova is drawn, rather than what it tracks.
 *
 * One concept rather than a column per setting. Each preference is declared
 * once in `PREFERENCE_SPECS` with the values it may take and the label its
 * control carries; the whole set is stored as a single JSON object on the user
 * row, so it follows the account rather than the browser; and it reaches the
 * page as data attributes on `<html>`, so CSS does the work and nothing has to
 * re-render for a preference to apply.
 *
 * Adding one is an entry below plus a block in `app.css`. The schema, the
 * layout and the settings form are all driven off this table and need no
 * change — motion, starfield density and the high-contrast palette (#14) are
 * ordinary entries, same as density.
 */

interface PreferenceSpec {
	/** The attribute CSS selects on. Set on `<html>`. */
	readonly attribute: string;
	/** What the control is called in settings. */
	readonly label: string;
	/** Every value this may take. The first one is the default. */
	readonly values: readonly string[];
	/** What each value is called in settings. */
	readonly options: Readonly<Record<string, string>>;
	/** A sentence under the control, when one earns its place. */
	readonly hint?: string;
	/**
	 * How this preference reaches behaviour. `'css'` (the default) means every
	 * non-default value has a block in `app.css` selecting the attribute —
	 * `preferences.test.ts` checks that. `'server'` means the server reads the
	 * value itself to decide what to render, so there is no CSS block to check
	 * for: the attribute is still stamped on `<html>`, but nothing selects it.
	 */
	readonly readBy?: 'css' | 'server';
}

export const PREFERENCE_SPECS = {
	density: {
		attribute: 'data-density',
		label: 'Density',
		values: ['default', 'compact'],
		options: {
			default: 'Default',
			compact: 'Compact — smaller dials, tighter rows, streak only'
		},
		hint: 'Compact fits more on a phone screen. Buttons and chips stay the same size in both.'
	},
	motion: {
		attribute: 'data-motion',
		label: 'Motion',
		values: ['system', 'full', 'reduced', 'none'],
		options: {
			system: 'Match system',
			full: 'Full — every orbit animates',
			reduced: 'Reduced — same as your OS setting',
			none: 'None — no animation anywhere'
		},
		hint: 'System follows your OS setting. Full and reduced each override it, in either direction.'
	},
	starfield: {
		attribute: 'data-starfield',
		label: 'Starfield',
		values: ['default', 'sparse', 'off'],
		options: {
			default: 'Default',
			sparse: 'Sparse — fewer, brighter stars',
			off: 'Off'
		}
	},
	contrast: {
		attribute: 'data-contrast',
		label: 'Contrast',
		values: ['default', 'high'],
		options: {
			default: 'Default',
			high: 'High — for bright sunlight'
		},
		hint: 'Solid panels and brighter text, for reading a dial outdoors.'
	},
	/**
	 * Which shape `/` renders in: the tiered grid of dials, or the universe
	 * (#11) — every goal as a body in one sky. `readBy: 'server'` because the
	 * choice decides which markup the server sends, not a CSS rule on top of
	 * the same markup, so there is nothing in `app.css` selecting on it.
	 */
	dashboard: {
		attribute: 'data-dashboard',
		label: 'Dashboard',
		values: ['tiers', 'universe'],
		options: {
			tiers: 'Tiers — a dial for every goal',
			universe: 'Universe — every goal in one sky you can fly'
		},
		readBy: 'server'
	}
} as const satisfies Record<string, PreferenceSpec>;

export type PreferenceKey = keyof typeof PREFERENCE_SPECS;

/**
 * A spec by key, typed uniformly rather than as the literal union
 * `PREFERENCE_SPECS[key]` produces when `key` is a generic `PreferenceKey` —
 * that union only has `attribute` in common, which breaks indexing `options`
 * or reading `hint` from a loop over every preference at once.
 */
export function specFor<K extends PreferenceKey>(key: K): PreferenceSpec {
	return PREFERENCE_SPECS[key];
}

export type PreferenceValue<K extends PreferenceKey> =
	(typeof PREFERENCE_SPECS)[K]['values'][number];

export type Preferences = { readonly [K in PreferenceKey]: PreferenceValue<K> };

export const PREFERENCE_KEYS = Object.keys(PREFERENCE_SPECS) as PreferenceKey[];

/** The first declared value of each preference, which is what a new account gets. */
export const DEFAULT_PREFERENCES = Object.fromEntries(
	PREFERENCE_KEYS.map((key) => [key, PREFERENCE_SPECS[key].values[0]])
) as Preferences;

/**
 * How far `--dial-scale` in `app.css` is allowed to shrink a dial.
 *
 * `OrbitDial` decides in JavaScript whether a body is large enough to carry its
 * detail, but the density that sizes it lives in CSS, which JavaScript cannot
 * see. Judging that against the smallest a dial can ever be drawn is the safe
 * direction — a silhouette at 13px reads fine, detail at 9px is mush — and
 * `preferences.test.ts` holds the two in step.
 */
export const MIN_DIAL_SCALE = 0.82;

function isValid<K extends PreferenceKey>(key: K, value: unknown): value is PreferenceValue<K> {
	return (PREFERENCE_SPECS[key].values as readonly unknown[]).includes(value);
}

/**
 * Read a stored blob, keeping only what is still recognised.
 *
 * Anything missing, malformed, or no longer offered falls back to its default,
 * so a row written by a newer build — or carrying a preference that has since
 * been withdrawn — can never leave the app in a state there is no CSS for.
 */
export function readPreferences(raw: string | null | undefined): Preferences {
	let parsed: unknown;
	try {
		parsed = raw ? JSON.parse(raw) : null;
	} catch {
		parsed = null;
	}

	const stored = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
		string,
		unknown
	>;

	return Object.fromEntries(
		PREFERENCE_KEYS.map((key) => [
			key,
			isValid(key, stored[key]) ? stored[key] : DEFAULT_PREFERENCES[key]
		])
	) as Preferences;
}

/** The form the user row holds. */
export function writePreferences(preferences: Preferences): string {
	return JSON.stringify(preferences);
}

/**
 * Fold submitted values into what is already stored.
 *
 * A form that leaves a preference out leaves it alone, and a value that is not
 * one this build offers is ignored rather than saved — the same rule
 * `readPreferences` applies, so nothing invalid can reach the database.
 */
export function mergePreferences(
	current: Preferences,
	submitted: Record<string, unknown>
): Preferences {
	return Object.fromEntries(
		PREFERENCE_KEYS.map((key) => [
			key,
			isValid(key, submitted[key]) ? submitted[key] : current[key]
		])
	) as Preferences;
}

/** The attributes CSS selects on, ready to go on `<html>`. */
export function preferenceAttributes(preferences: Preferences): Record<string, string> {
	return Object.fromEntries(
		PREFERENCE_KEYS.map((key) => [PREFERENCE_SPECS[key].attribute, preferences[key]])
	);
}

/**
 * The same attributes as markup, for the `<html>` tag the app renders into.
 *
 * Safe to interpolate without escaping: both halves come from `PREFERENCE_SPECS`
 * and nothing else, because every value that is not declared there has already
 * been replaced by its default on the way in.
 */
export function preferenceAttributeString(preferences: Preferences): string {
	return Object.entries(preferenceAttributes(preferences))
		.map(([name, value]) => `${name}="${value}"`)
		.join(' ');
}
