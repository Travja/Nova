import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

export interface DatabaseHealth {
	ok: boolean;
	latencyMs: number;
	error?: string;
}

/**
 * Proves the database file is open and answering, which is the failure the
 * container healthcheck actually cares about — the Node process can be alive
 * with the volume gone.
 */
export function checkDatabase(): DatabaseHealth {
	const started = performance.now();
	try {
		db.get(sql`select 1`);
		return { ok: true, latencyMs: Math.round((performance.now() - started) * 100) / 100 };
	} catch (error) {
		return {
			ok: false,
			latencyMs: Math.round((performance.now() - started) * 100) / 100,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
