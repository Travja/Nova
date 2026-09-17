import { building, dev } from '$app/environment';
import { SESSION_COOKIE, validateSession, clearSessionCookie } from '$lib/server/auth/session';
import { CLOCK_COOKIE, clockOverride } from '$lib/server/clock';
import { startBackupSchedule } from '$lib/server/backup';
import { handleServerError } from '$lib/server/errors';
import { logger, newTraceId, serializeError } from '$lib/server/log';
import { DEFAULT_PREFERENCES, preferenceAttributeString } from '$domain/preferences';
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

/**
 * The instant this request is answered against.
 *
 * One clock per request, so a goal cannot be measured against one and ranked
 * against another, and — in development only — a clock a test can pin. `dev` is
 * a literal `false` in a production build, so the override below is removed
 * from the bundle rather than merely skipped: nothing a request carries can
 * move a deployed instance's clock. See `$lib/server/clock`.
 */
const withClock: Handle = async ({ event, resolve }) => {
	const now = new Date();
	event.locals.now = dev
		? (clockOverride(event.cookies.get(CLOCK_COOKIE), event.locals.user?.timeZone ?? 'UTC', now) ??
			now)
		: now;
	return resolve(event);
};

/**
 * Stamp the account's preferences onto `<html>`, where CSS can select on them.
 *
 * `app.html` is a static file and Svelte cannot reach outside the body, so this
 * placeholder is the one seam that exists. Doing it server-side is the point:
 * the first paint is already at the right density, with no flash of the default
 * on every navigation. Anonymous visitors get the defaults.
 */
const withPreferences: Handle = async ({ event, resolve }) => {
	const attributes = preferenceAttributeString(
		event.locals.user?.preferences ?? DEFAULT_PREFERENCES
	);
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%nova.preferences%', attributes)
	});
};

export const handle: Handle = sequence(withRequestLogging, withSession, withClock, withPreferences);

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
