import { fieldErrors, formError, loginSchema, safeNextPath } from '$domain/validation';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { addressOf, loginThrottle } from '$lib/server/auth/login-throttle';
import {
	beginAuthentication,
	finishAuthentication,
	PASSKEY_SIGN_IN_FAILED,
	passkeysAvailable,
	readResponseField,
	setCeremonyCookie,
	takeCeremonyCookie
} from '$lib/server/auth/passkeys';
import { formatRetryAfter } from '$lib/server/rate-limit';
import { mailConfigured } from '$lib/server/mail';
import { authenticate } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, '/');
	return {
		// No point offering a reset link on an instance that cannot send one.
		canReset: mailConfigured,
		// Without an ORIGIN there is no domain to bind a passkey to.
		passkeys: passkeysAvailable(),
		justReset: url.searchParams.get('reset') === 'done'
	};
};

export const actions: Actions = {
	password: async ({ request, cookies, url, getClientAddress }) => {
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

		redirect(303, safeNextPath(url.searchParams.get('next')));
	},

	/**
	 * Step one of a passkey sign-in: a challenge for the browser to have signed.
	 * It names no account, so it says nothing about which ones exist.
	 */
	passkeyOptions: async ({ cookies }) => {
		const begun = await beginAuthentication();
		if (!begun) return fail(404, { errors: formError('Passkeys are not set up here.') });
		setCeremonyCookie(cookies, begun.ceremony);
		return { passkeyOptions: begun.options };
	},

	/**
	 * Step two: check what the authenticator signed and, if it holds, sign in
	 * exactly as a password does. Every failure is one message and one tick on
	 * the address's throttle, whatever the reason was.
	 */
	passkey: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const address = addressOf(getClientAddress);
		// Spent whatever happens next, including a throttled attempt.
		const ceremony = takeCeremonyCookie(cookies);

		const verdict = await loginThrottle.checkAddress(address);
		if (!verdict.allowed) {
			return fail(429, {
				errors: formError(
					`Too many sign-in attempts. Try again in ${formatRetryAfter(verdict.retryAfterMs)}.`
				)
			});
		}

		const result = await finishAuthentication(ceremony, readResponseField(form.get('response')));
		if (!result.ok) {
			await loginThrottle.recordAddressFailure(address);
			return fail(400, { errors: formError(PASSKEY_SIGN_IN_FAILED) });
		}

		await loginThrottle.recordSuccess({ email: result.user.email, address });

		const { token, expiresAt } = await createSession(
			result.user.id,
			request.headers.get('user-agent')
		);
		setSessionCookie(cookies, token, expiresAt);

		redirect(303, safeNextPath(url.searchParams.get('next')));
	}
};
