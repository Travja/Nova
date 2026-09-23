import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapshot, listSnapshots } from './snapshot';
import { startBackupSchedule, stopBackupSchedule, type BackupConfig } from './index';

let workspace: string;
let source: string;
let directory: string;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 30_000;
const INTERVAL_MS = 24 * HOUR_MS;

function config(overrides: Partial<BackupConfig> = {}): BackupConfig {
	return {
		enabled: true,
		databaseFile: source,
		directory,
		intervalMs: INTERVAL_MS,
		keepDaily: 7,
		keepWeekly: 4,
		...overrides
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	workspace = mkdtempSync(join(tmpdir(), 'nova-backup-schedule-'));
	source = join(workspace, 'nova.db');
	directory = join(workspace, 'backups');
	new Database(source).close();
});

afterEach(() => {
	stopBackupSchedule();
	vi.useRealTimers();
	rmSync(workspace, { recursive: true, force: true });
});

describe('startBackupSchedule', () => {
	it('takes one shortly after boot when the directory has never been backed up', () => {
		const now = new Date('2026-09-23T00:00:00Z');
		startBackupSchedule(config(), now);

		vi.advanceTimersByTime(FIRST_RUN_DELAY_MS - 1);
		expect(listSnapshots(directory)).toHaveLength(0);

		vi.advanceTimersByTime(1);
		expect(listSnapshots(directory)).toHaveLength(1);
	});

	it('takes one shortly after boot when the newest snapshot is older than the interval', () => {
		const now = new Date('2026-09-23T00:00:00Z');
		createSnapshot({ sourceFile: source, directory, now: new Date('2026-09-21T00:00:00Z') });

		startBackupSchedule(config(), now);
		vi.advanceTimersByTime(FIRST_RUN_DELAY_MS - 1);
		expect(listSnapshots(directory)).toHaveLength(1);

		vi.advanceTimersByTime(1);
		expect(listSnapshots(directory)).toHaveLength(2);
	});

	it('waits out the rest of the interval when the newest snapshot was taken minutes ago, so a restart loop cannot fill the disk', () => {
		const now = new Date('2026-09-23T00:00:00Z');
		createSnapshot({ sourceFile: source, directory, now: new Date('2026-09-22T23:55:00Z') });

		startBackupSchedule(config(), now);
		vi.advanceTimersByTime(FIRST_RUN_DELAY_MS);
		expect(listSnapshots(directory)).toHaveLength(1);

		// Simulate the container restarting a minute later: still not due for
		// almost 24h, so the new boot must not take another one either.
		stopBackupSchedule();
		startBackupSchedule(config(), new Date(now.getTime() + MINUTE_MS));
		vi.advanceTimersByTime(FIRST_RUN_DELAY_MS);
		expect(listSnapshots(directory)).toHaveLength(1);
	});

	it('runs a few hours after boot for a host that reboots more often than the interval', () => {
		// 20 hours old on a 24h interval: 4 hours still owed, not 24 from launch
		// and not skipped outright.
		const now = new Date('2026-09-23T00:00:00Z');
		createSnapshot({ sourceFile: source, directory, now: new Date('2026-09-22T04:00:00Z') });

		startBackupSchedule(config(), now);

		vi.advanceTimersByTime(4 * HOUR_MS - MINUTE_MS);
		expect(listSnapshots(directory)).toHaveLength(1);

		vi.advanceTimersByTime(MINUTE_MS);
		expect(listSnapshots(directory)).toHaveLength(2);
	});

	it('is a no-op when called a second time without stopping first', () => {
		const now = new Date('2026-09-23T00:00:00Z');
		expect(startBackupSchedule(config(), now)).toBe(true);
		expect(startBackupSchedule(config(), now)).toBe(false);
	});
});
