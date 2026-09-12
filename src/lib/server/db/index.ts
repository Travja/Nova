import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const url = env.DATABASE_URL ?? 'file:./data/nova.db';
const file = url.startsWith('file:') ? url.slice('file:'.length) : url;

function connect() {
	if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
	const sqlite = new Database(file);
	// WAL keeps reads from blocking the writer, which matters once the PWA is
	// syncing in the background from several tabs.
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	return drizzle(sqlite, { schema });
}

/**
 * A single connection for the process. During `vite build` the module is
 * imported for analysis only, so we avoid touching the filesystem then.
 */
export const db = building ? (null as unknown as ReturnType<typeof connect>) : connect();

export { schema };
