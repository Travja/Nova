import { fieldErrors, formError, passwordSchema, type FormErrors } from '$domain/validation';
import { listSessions, revokeOtherSessions, revokeSession } from '$lib/server/auth/session';
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

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return {
		sessions: await listSessions(locals.user.id, locals.sessionToken),
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
	}
};
