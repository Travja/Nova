import { fieldErrors, formError, loginSchema } from '$domain/validation';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { loginThrottle } from '$lib/server/auth/login-throttle';
import { formatRetryAfter } from '$lib/server/rate-limit';
import { authenticate } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return {};
};

/**
 * The address is only as trustworthy as the proxy in front of the app — behind
 * one, adapter-node needs `ADDRESS_HEADER` and `XFF_DEPTH` set or this is
 * whatever the client claimed. The per-account limit does not depend on it.
 */
function addressOf(getClientAddress: () => string): string | null {
	try {
		return getClientAddress() || null;
	} catch {
		return null;
	}
}

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
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

		const attempt = { email: parsed.data.email, address: addressOf(getClientAddress) };

		// Throttling happens before the password is checked, so a blocked attempt
		// costs an Argon2 hash neither here nor in `authenticate`.
		const verdict = await loginThrottle.check(attempt);
		if (!verdict.allowed) {
			return fail(429, {
				email: parsed.data.email,
				errors: formError(
					`Too many sign-in attempts. Try again in ${formatRetryAfter(verdict.retryAfterMs)}.`
				)
			});
		}

		const user = await authenticate(parsed.data.email, parsed.data.password);
		if (!user) {
			await loginThrottle.recordFailure(attempt);
			// Deliberately vague: never confirm which half was wrong. The throttle
			// counts the same for an unregistered email, so this message and the
			// one above stay the only two a stranger can tell apart.
			return fail(400, {
				email: parsed.data.email,
				errors: formError('That email and password combination did not work.')
			});
		}

		await loginThrottle.recordSuccess(attempt);

		const { token, expiresAt } = await createSession(user.id, request.headers.get('user-agent'));
		setSessionCookie(cookies, token, expiresAt);

		const next = url.searchParams.get('next');
		redirect(303, next?.startsWith('/') ? next : '/');
	}
};
