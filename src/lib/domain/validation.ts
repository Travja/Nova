import { z } from 'zod';
import { DEFAULT_COLOR, isPaletteColor } from './palette';
import { parseLocalDateTime, periodFor, periodLabel, type PeriodOptions } from './period';
import { cadenceOf, TIERS, type Tier } from './tiers';

/** Schemas shared by the form actions and by any future JSON API. */

export const emailSchema = z
	.string()
	.trim()
	.min(3, 'Enter your email address.')
	.max(254)
	.email('That does not look like an email address.')
	.transform((value) => value.toLowerCase());

export const passwordSchema = z
	.string()
	.min(8, 'Use at least 8 characters.')
	.max(256, 'That password is too long.');

export const registerSchema = z.object({
	email: emailSchema,
	password: passwordSchema,
	displayName: z.string().trim().min(1, 'What should we call you?').max(64),
	timeZone: z.string().trim().min(1).max(64).default('UTC'),
	weekStartsOn: z.coerce.number().int().min(0).max(6).default(1)
});

export const loginSchema = z.object({
	email: emailSchema,
	password: z.string().min(1, 'Enter your password.')
});

export const metricKindSchema = z.enum(['count', 'duration', 'checkin']);

export const goalSchema = z
	.object({
		title: z.string().trim().min(1, 'Give the goal a name.').max(80),
		description: z
			.string()
			.trim()
			.max(500)
			.optional()
			.transform((value) => (value ? value : null)),
		tier: z.enum(TIERS),
		metricKind: metricKindSchema,
		metricUnit: z.string().trim().max(24).default(''),
		target: z.coerce
			.number()
			.positive('The target has to be greater than zero.')
			.max(1_000_000, 'That target is out of this galaxy.'),
		color: z
			.string()
			.default(DEFAULT_COLOR)
			.refine(isPaletteColor, 'Pick one of the available colours.'),
		/*
		 * The goal this one feeds. Only its shape is checked here: whether it is
		 * the user's own, whether its cadence is longer and whether the edge would
		 * close a loop are all facts about the rest of the user's goals, so they
		 * are settled in `$domain/nesting` against a loaded set — at write time,
		 * never at read time.
		 *
		 * A `<select>` with nothing chosen posts an empty string, and JSON sends
		 * null; both mean "no parent" and both land as null.
		 */
		parentId: z.preprocess(
			(value) => (value === '' || value === null || value === undefined ? null : value),
			z.string().trim().max(64).nullable().default(null)
		)
	})
	.transform((value) => ({
		...value,
		// A check-in goal counts closings, so its unit is implied.
		metricUnit: value.metricKind === 'duration' ? 'minutes' : value.metricUnit
	}));

/** A phone with a slightly fast clock should still be able to log "now". */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** The window an entry's `occurredAt` may fall in for a particular goal. */
export interface OccurredAtBounds {
	earliest: Date;
	latest: Date;
	/** How the earliest orbit is named, so the error can say what the floor is. */
	earliestLabel: string;
	/** The zone a `datetime-local` value is read in — never the server's. */
	timeZone: string;
}

/**
 * Backdating reaches to the start of the orbit the goal launched in — a Planet
 * goal added on Wednesday can still take Monday's work — but no further, since
 * an entry in an orbit that predates the goal would invent history.
 */
export function occurredAtBounds(
	goal: { tier: Tier; createdAt: Date },
	options: PeriodOptions,
	now: Date = new Date()
): OccurredAtBounds {
	const launch = periodFor(goal.createdAt, cadenceOf(goal.tier), options);
	return {
		earliest: launch.start,
		latest: new Date(now.getTime() + CLOCK_SKEW_MS),
		earliestLabel: periodLabel(launch, options.timeZone),
		timeZone: options.timeZone
	};
}

/**
 * The id a browser gives an entry before it has ever been sent.
 *
 * An entry logged offline is retried until it lands, and a retry after a
 * partial failure cannot tell whether the first attempt was written — so the
 * id travels with the entry and the insert conflicts on it. Bounded and
 * alphanumeric because it reaches a unique index: `crypto.randomUUID()` is
 * what the queue actually sends.
 */
export const clientEntryIdSchema = z
	.string()
	.trim()
	.min(8, 'That entry id is too short.')
	.max(64, 'That entry id is too long.')
	.regex(/^[A-Za-z0-9_-]+$/, 'That entry id has characters Nova cannot store.');

/**
 * Entries validate the same way wherever they come from. Pass bounds to police
 * backdating; without them any timestamp parses, which is what the quick-log
 * path on the dashboard needs since it never sends one.
 */
export function entrySchemaFor(bounds?: OccurredAtBounds) {
	return z.object({
		clientId: z.preprocess(
			(value) => (value === '' || value === null ? undefined : value),
			clientEntryIdSchema.optional()
		),
		amount: z.coerce
			.number()
			.refine((value) => value !== 0, 'Log something other than zero.')
			.refine((value) => Math.abs(value) <= 1_000_000, 'That is a suspiciously large amount.'),
		note: z
			.string()
			.trim()
			.max(200)
			// Nullable as well as optional: a form leaves the field out, while the
			// offline queue sends the entry as JSON with `note: null` for one that
			// never had a note. Both mean the same thing, and both land as null.
			.nullish()
			.transform((value) => (value ? value : null)),
		occurredAt: z
			.preprocess((value) => {
				if (value === '' || value === null || value === undefined) return undefined;
				if (typeof value !== 'string') return value;
				// Browsers send wall-clock time with no zone, so read it in the
				// user's own; anything else falls back to normal Date parsing.
				return (bounds && parseLocalDateTime(value, bounds.timeZone)) ?? new Date(value);
			}, z.date('Nova could not read that date and time.').optional())
			.refine(
				(value) => !value || !bounds || value.getTime() <= bounds.latest.getTime(),
				'That is in the future. Log it once it has happened.'
			)
			.refine(
				(value) => !value || !bounds || value.getTime() >= bounds.earliest.getTime(),
				bounds
					? `Nothing lands before ${bounds.earliestLabel}, when this goal launched.`
					: 'That is before the goal launched.'
			)
	});
}

export const entrySchema = entrySchemaFor();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
export type EntryInput = z.infer<typeof entrySchema>;

/**
 * Resolve a `?next=` value to a path that can only land back on this site.
 *
 * `value.startsWith('/')` is not enough on its own: `//evil.com` satisfies it
 * and browsers read it as protocol-relative, so signing in would hand the user
 * straight to somebody else's page — a good place to ask them to re-enter the
 * password they just typed.
 *
 * Two more things browsers do before parsing a URL have to be undone first:
 * they strip tabs and newlines, and they treat a backslash as a slash. Both
 * turn an apparently safe value into an authority.
 */
export function safeNextPath(value: string | null | undefined, fallback = '/'): string {
	if (!value) return fallback;

	const normalized = value.replace(/[\t\n\r]/g, '').replace(/\\/g, '/');

	if (!normalized.startsWith('/')) return fallback;
	if (normalized.startsWith('//')) return fallback;

	return normalized;
}

/** Field name to message, with `form` reserved for errors that belong to the whole form. */
export type FormErrors = Record<string, string>;

/** A form-level message in the same shape as field errors, so payloads union cleanly. */
export function formError(message: string): FormErrors {
	return { form: message };
}

/** Collapse a ZodError into `{ field: message }` for rendering next to inputs. */
export function fieldErrors(error: z.ZodError): FormErrors {
	const result: FormErrors = {};
	for (const issue of error.issues) {
		const key = issue.path.join('.') || 'form';
		result[key] ??= issue.message;
	}
	return result;
}
