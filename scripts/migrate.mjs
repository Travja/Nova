/**
 * Applies pending Drizzle migrations. Run before the server starts — the
 * Docker entrypoint does this automatically.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.env.DATABASE_URL ?? 'file:./data/nova.db';
const file = url.startsWith('file:') ? url.slice('file:'.length) : url;

if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
sqlite.close();

console.log(`migrations applied to ${file}`);
