import { updateProfile } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { fieldErrors } from '$domain/validation';
import { mergePreferences } from '$domain/preferences';

const profileSchema = z.object({
	displayName: z.string().trim().min(1, 'What should we call you?').max(64),
	timeZone: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.refine((value) => {
			// A bad zone would break every period boundary, so verify it here.
			try {
				new Intl.DateTimeFormat('en-US', { timeZone: value });
				return true;
			} catch {
				return false;
			}
		}, 'That is not a time zone Nova recognises.'),
	weekStartsOn: z.coerce.number().int().min(0).max(6)
});

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return { profile: locals.user };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = profileSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		// Preferences are validated by the preference table itself rather than by
		// the schema above: anything it does not recognise falls back to what is
		// already stored, so an unknown value is ignored rather than rejected.
		const preferences = mergePreferences(locals.user.preferences, Object.fromEntries(form));

		await updateProfile(locals.user.id, { ...parsed.data, preferences });
		return { saved: true };
	}
};
