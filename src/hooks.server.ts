import { building } from '$app/environment';
import { SESSION_COOKIE, validateSession, clearSessionCookie } from '$lib/server/auth/session';
import { startBackupSchedule } from '$lib/server/backup';
import { handleServerError } from '$lib/server/errors';
import { logger, newTraceId, serializeError } from '$lib/server/log';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';

// Snapshots run in-process so a stock `docker compose up` is backed up without
// anyone wiring up cron. Off while developing; see `readBackupConfig()`.
if (!building) startBackupSchedule();

/** The container healthcheck polls this every 30s; it does not belong in the request stream. */
const HEALTH_PATH = '/health';

/**
 * One line per request: method, path, status, duration, and the signed-in user
 * when there is one. The query string is deliberately left out — it is the one
 * part of a URL that can carry a token — and every field goes through the
 * logger's redaction on the way out.
 */
const withRequestLogging: Handle = async ({ event, resolve }) => {
	const requestId = newTraceId(8);
	event.locals.requestId = requestId;

	const started = performance.now();
	let response: Response;
	try {
		response = await resolve(event);
	} catch (error) {
		logger.error('request aborted', {
			requestId,
			method: event.request.method,
			path: event.url.pathname,
			durationMs: Math.round(performance.now() - started),
			error: serializeError(error)
		});
		throw error;
	}

	const fields = {
		requestId,
		method: event.request.method,
		path: event.url.pathname,
		status: response.status,
		durationMs: Math.round(performance.now() - started),
		userId: event.locals.user?.id ?? null
	};

	if (event.url.pathname === HEALTH_PATH) logger.debug('request', fields);
	else if (response.status >= 500) logger.error('request', fields);
	else if (response.status >= 400) logger.warn('request', fields);
	else logger.info('request', fields);

	response.headers.set('x-request-id', requestId);
	return response;
};

const withSession: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = token ? await validateSession(token) : null;

	// A token that no longer resolves is stale; drop it so the browser stops
	// sending it on every request.
	if (token && !event.locals.user) clearSessionCookie(event.cookies);

	return resolve(event);
};

export const handle: Handle = sequence(withRequestLogging, withSession);

/**
 * Every unexpected error gets an id. The detail — including the stack — goes to
 * the logs; the user gets the id and nothing else, so a screenshot is enough to
 * find the failure without exposing internals.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) =>
	handleServerError({
		error,
		status,
		message,
		method: event.request.method,
		path: event.url.pathname,
		userId: event.locals.user?.id ?? null,
		requestId: event.locals.requestId
	});
