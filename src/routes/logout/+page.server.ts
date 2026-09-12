import { clearSessionCookie, invalidateSession } from '$lib/server/auth/session';
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Signing out is a POST; a stray GET just goes home.
export const load: PageServerLoad = async () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ locals, cookies }) => {
		if (locals.sessionToken) await invalidateSession(locals.sessionToken);
		clearSessionCookie(cookies);
		redirect(303, '/');
	}
};
