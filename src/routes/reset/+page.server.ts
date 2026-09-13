import { fieldErrors, formError, passwordSchema } from '$domain/validation';
import { completePasswordReset, resetTokenIsUsable } from '$lib/server/auth/reset';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const resetSchema = z
	.object({
		token: z.string().min(1),
		password: passwordSchema,
		confirmPassword: z.string().min(1, 'Type the new password again.')
	})
	.refine((value) => value.password === value.confirmPassword, {
		path: ['confirmPassword'],
		message: 'Those two do not match.'
	});

export const load: PageServerLoad = async ({ url, locals }) => {
	if (locals.user) redirect(303, '/settings/security');

	const token = url.searchParams.get('token') ?? '';
	// The token is checked but not spent, so a mail client that prefetches the
	// link does not burn it before its owner clicks.
	return { token, usable: token ? await resetTokenIsUsable(token) : false };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const parsed = resetSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const result = await completePasswordReset(parsed.data.token, parsed.data.password);
		if (!result.ok) {
			return fail(400, {
				errors: formError('That link has expired or has already been used. Ask for a new one.')
			});
		}

		// Every session was revoked with the reset, including any the person who
		// prompted it was holding, so signing in again is the only way back.
		redirect(303, '/login?reset=done');
	}
};
