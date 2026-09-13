import { emailSchema, fieldErrors, formError } from '$domain/validation';
import { addressOf, resetRequestThrottle } from '$lib/server/auth/login-throttle';
import { createPasswordReset, RESET_LIFETIME_MINUTES } from '$lib/server/auth/reset';
import { logger } from '$lib/server/log';
import { mailConfigured, sendInBackground } from '$lib/server/mail';
import { readOrigin } from '$lib/server/mail/config';
import { passwordResetMessage } from '$lib/server/mail/messages';
import { formatRetryAfter } from '$lib/server/rate-limit';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const requestSchema = z.object({ email: emailSchema });

export const load: PageServerLoad = async ({ locals }) => {
	// Already signed in? The password lives in settings, not here.
	if (locals.user) redirect(303, '/settings/security');
	return { configured: mailConfigured };
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		if (!mailConfigured) {
			return fail(503, {
				errors: formError('This Nova instance cannot send email, so it cannot send a reset link.')
			});
		}

		const form = await request.formData();
		const parsed = requestSchema.safeParse({ email: form.get('email') });
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const attempt = { email: parsed.data.email, address: addressOf(getClientAddress) };
		const verdict = await resetRequestThrottle.check(attempt);
		if (!verdict.allowed) {
			return fail(429, {
				errors: formError(
					`A reset link has already been asked for. Try again in ${formatRetryAfter(verdict.retryAfterMs)}.`
				)
			});
		}
		await resetRequestThrottle.recordFailure(attempt);

		const origin = readOrigin();
		if (!origin) {
			// A link built from the request's Host header would point wherever the
			// sender liked, so there is no safe fallback: refuse rather than guess.
			logger.error('password reset needs ORIGIN to build a link');
			return fail(503, {
				errors: formError('This Nova instance is not configured to send reset links.')
			});
		}

		const reset = await createPasswordReset(parsed.data.email);
		if (reset) {
			const link = `${origin}/reset?token=${encodeURIComponent(reset.token)}`;
			sendInBackground(
				passwordResetMessage({
					to: reset.user.email,
					displayName: reset.user.displayName,
					link,
					expiresInMinutes: RESET_LIFETIME_MINUTES
				}),
				// The token never reaches the logs — only who it was for.
				{ userId: reset.user.id, purpose: 'password-reset' }
			);
		}

		// Identical whether or not anybody owns that address, and it does not
		// wait for the send, so the timing says nothing either.
		return { sent: true };
	}
};
