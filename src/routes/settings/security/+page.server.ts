import { fieldErrors, formError, passwordSchema, type FormErrors } from '$domain/validation';
import { listSessions, revokeOtherSessions, revokeSession } from '$lib/server/auth/session';
import { addressOf, loginThrottle } from '$lib/server/auth/login-throttle';
import {
	beginRegistration,
	finishRegistration,
	listPasskeys,
	PASSKEY_NAME_MAX,
	passkeysAvailable,
	readResponseField,
	removePasskey,
	renamePasskey,
	setCeremonyCookie,
	signedInRecently,
	takeCeremonyCookie
} from '$lib/server/auth/passkeys';
import { formatRetryAfter } from '$lib/server/rate-limit';
import { changePassword } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

const passwordChangeSchema = z
	.object({
		currentPassword: z.string().min(1, 'Enter your current password.'),
		newPassword: passwordSchema,
		confirmPassword: z.string().min(1, 'Type the new password again.')
	})
	.refine((value) => value.newPassword === value.confirmPassword, {
		path: ['confirmPassword'],
		message: 'Those two do not match.'
	})
	.refine((value) => value.newPassword !== value.currentPassword, {
		path: ['newPassword'],
		message: 'That is the password you already have.'
	});

const passkeyNameSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Give it a name.')
		.max(PASSKEY_NAME_MAX, `Keep it to ${PASSKEY_NAME_MAX} characters.`)
});

/** What a passkey change says when the recent-sign-in guard turns it away. */
const REAUTHENTICATE = 'Enter your password to change your passkeys.';

/**
 * The password typed to confirm a passkey change, or null when none was.
 *
 * A stolen session could use this field to guess the password, so a wrong one
 * is counted on the sign-in throttle exactly as the login form counts it, and
 * a throttled account cannot try again here either.
 */
async function confirmationPassword(
	form: FormData,
	email: string,
	address: string | null
): Promise<{ password: string | null; blocked: string | null }> {
	const typed = form.get('password');
	const password = typeof typed === 'string' && typed.length > 0 ? typed : null;
	if (!password) return { password: null, blocked: null };

	const verdict = await loginThrottle.check({ email, address });
	if (!verdict.allowed) {
		return {
			password: null,
			blocked: `Too many attempts. Try again in ${formatRetryAfter(verdict.retryAfterMs)}.`
		};
	}
	return { password, blocked: null };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return {
		sessions: await listSessions(locals.user.id, locals.sessionToken),
		passkeys: await listPasskeys(locals.user.id),
		passkeysAvailable: passkeysAvailable(),
		// Whether a passkey change will ask for the password again.
		recentSignIn: await signedInRecently(locals.user.id, locals.sessionToken, locals.now.getTime()),
		// Stamps are rendered in the user's own zone on both sides of hydration.
		timeZone: locals.user.timeZone
	};
};

export const actions: Actions = {
	password: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = passwordChangeSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const result = await changePassword(
			locals.user.id,
			parsed.data.currentPassword,
			parsed.data.newPassword,
			locals.sessionToken
		);

		if (!result.ok) {
			// Typed, not a bare literal: a plain object breaks narrowing in the page.
			const errors: FormErrors = { currentPassword: 'That is not your current password.' };
			return fail(400, { errors });
		}

		return { passwordChanged: true, revoked: result.revoked };
	},

	revoke: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { errors: formError('Pick a session to sign out.') });

		// `revokeSession` re-reads the row under this user's id, so an id copied
		// from somebody else's page removes nothing.
		const revoked = await revokeSession(locals.user.id, id);
		if (!revoked) return fail(404, { errors: formError('That session has already ended.') });

		return { revoked: 1 };
	},

	revokeOthers: async ({ locals }) => {
		if (!locals.user) redirect(303, '/login');

		const revoked = await revokeOtherSessions(locals.user.id, locals.sessionToken);
		return { revoked };
	},

	/**
	 * Step one of adding a passkey. The recent-sign-in guard runs here, in
	 * `beginRegistration`, and the ceremony it opens is bound to this session.
	 */
	passkeyOptions: async ({ request, locals, cookies, getClientAddress }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const attempt = { email: locals.user.email, address: addressOf(getClientAddress) };
		const { password, blocked } = await confirmationPassword(form, attempt.email, attempt.address);
		if (blocked) return fail(429, { reauthenticate: true, errors: formError(blocked) });

		const begun = await beginRegistration(locals.user, locals.sessionToken, password);
		if (!begun.ok) {
			if (begun.reason === 'unavailable') {
				return fail(404, { errors: formError('Passkeys are not set up here.') });
			}
			if (password) await loginThrottle.recordFailure(attempt);
			const errors: FormErrors = password
				? { password: 'That is not your password.' }
				: formError(REAUTHENTICATE);
			return fail(403, { reauthenticate: true, errors });
		}

		setCeremonyCookie(cookies, begun.ceremony);
		return { passkeyOptions: begun.options };
	},

	/** Step two: store what the authenticator made, if it checks out. */
	addPasskey: async ({ request, locals, cookies }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const result = await finishRegistration(
			locals.user.id,
			locals.sessionToken,
			takeCeremonyCookie(cookies),
			readResponseField(form.get('response')),
			request.headers.get('user-agent')
		);
		if (!result.ok) {
			return fail(400, { errors: formError('That passkey could not be added. Try again.') });
		}
		return { passkeyAdded: result.passkey.name };
	},

	renamePasskey: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const parsed = passkeyNameSchema.safeParse({ name: form.get('name') ?? '' });
		if (!parsed.success) return fail(400, { renaming: id, errors: fieldErrors(parsed.error) });

		// Ownership is checked in the statement, so another account's id renames nothing.
		const renamed = await renamePasskey(locals.user.id, id, parsed.data.name);
		if (!renamed) return fail(404, { errors: formError('That passkey has already been removed.') });
		return { passkeyRenamed: parsed.data.name };
	},

	removePasskey: async ({ request, locals, getClientAddress }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const attempt = { email: locals.user.email, address: addressOf(getClientAddress) };
		const { password, blocked } = await confirmationPassword(form, attempt.email, attempt.address);
		if (blocked) return fail(429, { reauthenticate: true, errors: formError(blocked) });

		const result = await removePasskey(locals.user.id, locals.sessionToken, password, id);
		if (!result.ok) {
			if (result.reason === 'not-found') {
				return fail(404, { errors: formError('That passkey has already been removed.') });
			}
			if (password) await loginThrottle.recordFailure(attempt);
			const errors: FormErrors = password
				? { password: 'That is not your password.' }
				: formError(REAUTHENTICATE);
			return fail(403, { reauthenticate: true, errors });
		}
		return { passkeyRemoved: true };
	}
};
