import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBackup, type BackupConfig } from './index';
import { createSnapshot, listSnapshots, parseSnapshotName, snapshotName } from './snapshot';

let workspace: string;
let source: string;
let directory: string;
let live: Database.Database;

/** A stand-in for the real schema: enough rows to prove the data survives. */
function seed(db: Database.Database, count: number) {
	db.exec('CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)');
	const insert = db.prepare('INSERT INTO entries (amount) VALUES (?)');
	const many = db.transaction((rows: number[]) => rows.forEach((amount) => insert.run(amount)));
	many(Array.from({ length: count }, (_, index) => index + 1));
}

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), 'nova-backup-'));
	source = join(workspace, 'nova.db');
	directory = join(workspace, 'backups');

	// Exactly how the app opens it: WAL, which is what makes a plain file copy
	// unsafe while the server is running.
	live = new Database(source);
	live.pragma('journal_mode = WAL');
	live.pragma('foreign_keys = ON');
	seed(live, 25);
});

afterEach(() => {
	live.close();
	rmSync(workspace, { recursive: true, force: true });
});

describe('snapshot names', () => {
	it('round-trips the instant it was taken', () => {
		const at = new Date('2026-09-13T03:30:00Z');
		expect(snapshotName(at)).toBe('nova-20260913T033000Z.db');
		expect(parseSnapshotName(snapshotName(at))).toBe(at.getTime());
	});

	it('ignores anything that is not one of ours', () => {
		expect(parseSnapshotName('nova.db')).toBeNull();
		expect(parseSnapshotName('nova-20260913T033000Z.db.partial')).toBeNull();
	});
});

describe('createSnapshot', () => {
	it('restores into a working database, including writes still sitting in the WAL', () => {
		// The rows above were written and never checkpointed, so they live in
		// nova.db-wal right now. Copying nova.db alone would lose them.
		expect(existsSync(`${source}-wal`)).toBe(true);

		const snapshot = createSnapshot({ sourceFile: source, directory });

		// Writes that land after the snapshot must not appear in it: a backup is
		// a point in time, not a moving target.
		live.prepare('INSERT INTO entries (amount) VALUES (?)').run(999);

		// Restore the way the docs say to: copy the snapshot into place, open it.
		const restoredPath = join(workspace, 'restored.db');
		copyFileSync(snapshot.path, restoredPath);
		const restored = new Database(restoredPath, { fileMustExist: true });

		expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
		expect(restored.prepare('SELECT count(*) AS n FROM entries').get()).toEqual({ n: 25 });
		expect(restored.prepare('SELECT sum(amount) AS total FROM entries').get()).toEqual({
			total: 325
		});

		// A working database, not just a readable one.
		restored.pragma('journal_mode = WAL');
		restored.prepare('INSERT INTO entries (amount) VALUES (?)').run(42);
		expect(restored.prepare('SELECT count(*) AS n FROM entries').get()).toEqual({ n: 26 });
		restored.close();
	});

	it('writes one self-contained file, with no sidecar to remember', () => {
		const snapshot = createSnapshot({ sourceFile: source, directory });

		expect(existsSync(`${snapshot.path}-wal`)).toBe(false);
		expect(existsSync(`${snapshot.path}-shm`)).toBe(false);
		expect(readdirSync(directory)).toEqual([snapshot.name]);
		expect(snapshot.bytes).toBeGreaterThan(0);
	});

	it('leaves the live database usable while it runs', () => {
		createSnapshot({ sourceFile: source, directory });
		live.prepare('INSERT INTO entries (amount) VALUES (?)').run(7);
		expect(live.prepare('SELECT count(*) AS n FROM entries').get()).toEqual({ n: 26 });
	});

	it('lists what it wrote, newest first', () => {
		createSnapshot({ sourceFile: source, directory, now: new Date('2026-09-11T03:00:00Z') });
		createSnapshot({ sourceFile: source, directory, now: new Date('2026-09-13T03:00:00Z') });

		const listed = listSnapshots(directory);
		expect(listed.map((file) => file.name)).toEqual([
			'nova-20260913T030000Z.db',
			'nova-20260911T030000Z.db'
		]);
	});

	it('reports an empty directory rather than throwing', () => {
		expect(listSnapshots(join(workspace, 'nope'))).toEqual([]);
	});
});

describe('runBackup', () => {
	const config = (overrides: Partial<BackupConfig> = {}): BackupConfig => ({
		enabled: true,
		databaseFile: source,
		directory,
		intervalMs: 86_400_000,
		keepDaily: 2,
		keepWeekly: 0,
		...overrides
	});

	it('rotates older snapshots away as it takes new ones', () => {
		for (const day of ['09', '10', '11', '12', '13']) {
			runBackup(config(), new Date(`2026-09-${day}T03:00:00Z`));
		}

		expect(readdirSync(directory).sort()).toEqual([
			'nova-20260912T030000Z.db',
			'nova-20260913T030000Z.db'
		]);
	});

	it('keeps a weekly snapshot the daily window has already passed', () => {
		for (let day = 1; day <= 13; day += 1) {
			runBackup(
				config({ keepDaily: 2, keepWeekly: 2 }),
				new Date(`2026-09-${String(day).padStart(2, '0')}T03:00:00Z`)
			);
		}

		const kept = readdirSync(directory).sort();
		// The two most recent days, plus the newest of the week before them.
		expect(kept).toEqual([
			'nova-20260906T030000Z.db',
			'nova-20260912T030000Z.db',
			'nova-20260913T030000Z.db'
		]);
	});

	it('reports what it took and what it dropped', () => {
		runBackup(config(), new Date('2026-09-12T03:00:00Z'));
		const result = runBackup(config({ keepDaily: 1 }), new Date('2026-09-13T03:00:00Z'));

		expect(result.snapshot).toBe('nova-20260913T030000Z.db');
		expect(result.kept).toBe(1);
		expect(result.removed).toEqual(['nova-20260912T030000Z.db']);
		expect(result.bytes).toBeGreaterThan(0);
	});
});
