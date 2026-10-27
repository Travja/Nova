import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '$lib/server/db/schema';

/**
 * A stand-in for `$lib/server/db` in unit tests: an in-memory SQLite with every
 * committed migration applied and foreign keys on, exactly as the app opens
 * its file. Tests that need the real schema — a cascade, a unique index —
 * mock the module with this:
 *
 *     vi.mock('$lib/server/db', () => import('$lib/server/testing/memory-db'));
 *
 * Each test file gets its own module registry and so its own database.
 */
function connect() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

export const db = connect();

export { schema };
