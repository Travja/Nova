import { z } from 'zod';
import { DEFAULT_COLOR, isPaletteColor } from './palette';
import { TIERS } from './tiers';

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
			.refine(isPaletteColor, 'Pick one of the available colours.')
	})
	.transform((value) => ({
		...value,
		// A check-in goal counts closings, so its unit is implied.
		metricUnit: value.metricKind === 'duration' ? 'minutes' : value.metricUnit
	}));

export const entrySchema = z.object({
	amount: z.coerce
		.number()
		.refine((value) => value !== 0, 'Log something other than zero.')
		.refine((value) => Math.abs(value) <= 1_000_000, 'That is a suspiciously large amount.'),
	note: z
		.string()
		.trim()
		.max(200)
		.optional()
		.transform((value) => (value ? value : null)),
	occurredAt: z.coerce.date().optional()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
export type EntryInput = z.infer<typeof entrySchema>;

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
