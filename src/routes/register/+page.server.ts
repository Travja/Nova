import { fieldErrors, registerSchema, type FormErrors } from '$domain/validation';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { registerUser } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const values = {
			email: form.get('email'),
			password: form.get('password'),
			displayName: form.get('displayName'),
			// The browser fills this in; anyone without JS lands on UTC and can
			// change it in settings.
			timeZone: String(form.get('timeZone') || 'UTC'),
			weekStartsOn: form.get('weekStartsOn') ?? 1
		};

		const parsed = registerSchema.safeParse(values);
		if (!parsed.success) {
			return fail(400, {
				email: String(values.email ?? ''),
				displayName: String(values.displayName ?? ''),
				errors: fieldErrors(parsed.error)
			});
		}

		const result = await registerUser(parsed.data);
		if (!result.ok) {
			const errors: FormErrors = { email: 'That email is already registered.' };
			return fail(400, {
				email: parsed.data.email,
				displayName: parsed.data.displayName,
				errors
			});
		}

		const { token, expiresAt } = await createSession(result.user.id);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/goals/new');
	}
};
