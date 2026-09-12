import { SESSION_COOKIE, validateSession, clearSessionCookie } from '$lib/server/auth/session';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = token ? await validateSession(token) : null;

	// A token that no longer resolves is stale; drop it so the browser stops
	// sending it on every request.
	if (token && !event.locals.user) clearSessionCookie(event.cookies);

	return resolve(event);
};
