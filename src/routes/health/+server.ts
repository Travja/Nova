import { checkDatabase } from '$lib/server/db/health';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Liveness plus a database probe, for the Docker healthcheck. Fetching `/`
 * would render the whole dashboard just to prove the process is up.
 *
 * Anonymous on purpose — a healthcheck has no session — so it reports only
 * whether the database answers, never anything about its contents.
 */
export const GET: RequestHandler = async () => {
	const database = checkDatabase();
	return json(
		{
			status: database.ok ? 'ok' : 'error',
			uptimeSeconds: Math.round(process.uptime()),
			database
		},
		{ status: database.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
