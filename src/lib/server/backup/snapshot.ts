/**
 * Taking a snapshot of the SQLite file.
 *
 * The database runs in WAL mode, so copying `nova.db` while the server is
 * writing gives you a file whose newest transactions are still sitting in the
 * `-wal` sidecar: restore it on its own and you silently lose them. `VACUUM
 * INTO` asks SQLite for a consistent copy instead — one self-contained file,
 * WAL included, taken without blocking writers and without stopping the app.
 *
 * Only node builtins and better-sqlite3 here: no SvelteKit imports, so this is
 * testable against a scratch database.
 */
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SnapshotFile } from './retention';

const PREFIX = 'nova-';
const SUFFIX = '.db';
/** A snapshot still being written; never a restore candidate. */
const PARTIAL_SUFFIX = '.partial';
const NAME_PATTERN = /^nova-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

export interface Snapshot extends SnapshotFile {
	path: string;
	bytes: number;
}

/** `nova-20260913T033000Z.db` — sorts chronologically as a string. */
export function snapshotName(at: Date): string {
	return `${PREFIX}${at
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d+Z$/, 'Z')}${SUFFIX}`;
}

/** Epoch milliseconds encoded in a snapshot name, or null if it is not one of ours. */
export function parseSnapshotName(name: string): number | null {
	const match = NAME_PATTERN.exec(name);
	if (!match) return null;
	const [, year, month, day, hour, minute, second] = match;
	return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
}

export function listSnapshots(directory: string): Snapshot[] {
	let entries: string[];
	try {
		entries = readdirSync(directory);
	} catch {
		return [];
	}

	const snapshots: Snapshot[] = [];
	for (const name of entries) {
		const takenAt = parseSnapshotName(name);
		if (takenAt === null) continue;
		const path = join(directory, name);
		snapshots.push({ name, takenAt, path, bytes: statSync(path).size });
	}
	return snapshots.sort((a, b) => b.takenAt - a.takenAt);
}

/**
 * Writes one consistent copy of `sourceFile` into `directory`.
 *
 * The copy lands under a `.partial` name and is renamed once SQLite is done, so
 * a crash mid-vacuum cannot leave something that looks like a usable snapshot.
 */
export function createSnapshot(options: {
	sourceFile: string;
	directory: string;
	now?: Date;
}): Snapshot {
	const { sourceFile, directory, now = new Date() } = options;

	mkdirSync(directory, { recursive: true });
	const name = snapshotName(now);
	const path = join(directory, name);
	const partial = `${path}${PARTIAL_SUFFIX}`;
	rmSync(partial, { force: true });

	const source = new Database(sourceFile, { fileMustExist: true });
	try {
		// VACUUM INTO takes no bound parameters, so the path is quoted by hand.
		source.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
	} finally {
		source.close();
	}

	renameSync(partial, path);
	return { name, path, takenAt: now.getTime(), bytes: statSync(path).size };
}

/** Deletes the named snapshots. Returns the names actually removed. */
export function removeSnapshots(directory: string, names: string[]): string[] {
	const removed: string[] = [];
	for (const name of names) {
		if (parseSnapshotName(name) === null) continue;
		rmSync(join(directory, name), { force: true });
		removed.push(name);
	}
	return removed;
}
