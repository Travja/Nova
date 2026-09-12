import { fieldErrors, formError, loginSchema } from '$domain/validation';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { authenticate } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const parsed = loginSchema.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});

		if (!parsed.success) {
			return fail(400, {
				email: String(form.get('email') ?? ''),
				errors: fieldErrors(parsed.error)
			});
		}

		const user = await authenticate(parsed.data.email, parsed.data.password);
		if (!user) {
			// Deliberately vague: never confirm which half was wrong.
			return fail(400, {
				email: parsed.data.email,
				errors: formError('That email and password combination did not work.')
			});
		}

		const { token, expiresAt } = await createSession(user.id);
		setSessionCookie(cookies, token, expiresAt);

		const next = url.searchParams.get('next');
		redirect(303, next?.startsWith('/') ? next : '/');
	}
};
