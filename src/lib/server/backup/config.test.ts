import { describe, expect, it } from 'vitest';
import { readBackupConfig } from './index';

const production = { NODE_ENV: 'production', DATABASE_URL: 'file:/data/nova.db' };

describe('readBackupConfig', () => {
	it('backs up next to the database by default in production', () => {
		expect(readBackupConfig(production)).toMatchObject({
			enabled: true,
			databaseFile: '/data/nova.db',
			directory: '/data/backups',
			intervalMs: 24 * 60 * 60 * 1000,
			keepDaily: 7,
			keepWeekly: 4
		});
	});

	it('stays out of the way while developing unless asked', () => {
		expect(readBackupConfig({ DATABASE_URL: 'file:./data/nova.db' }).enabled).toBe(false);
		expect(
			readBackupConfig({ DATABASE_URL: 'file:./data/nova.db', BACKUP_ENABLED: 'true' })
		).toMatchObject({ enabled: true, directory: 'data/backups' });
	});

	it('can be switched off in production', () => {
		expect(readBackupConfig({ ...production, BACKUP_ENABLED: 'false' }).enabled).toBe(false);
	});

	it('never schedules against an in-memory database', () => {
		expect(readBackupConfig({ ...production, DATABASE_URL: ':memory:' }).enabled).toBe(false);
	});

	it('reads the schedule and the retention window from the environment', () => {
		expect(
			readBackupConfig({
				...production,
				BACKUP_DIR: '/mnt/backups',
				BACKUP_INTERVAL_HOURS: '6',
				BACKUP_KEEP_DAILY: '14',
				BACKUP_KEEP_WEEKLY: '0'
			})
		).toMatchObject({
			directory: '/mnt/backups',
			intervalMs: 6 * 60 * 60 * 1000,
			keepDaily: 14,
			keepWeekly: 0
		});
	});

	it('falls back to the defaults when a value makes no sense', () => {
		expect(
			readBackupConfig({ ...production, BACKUP_INTERVAL_HOURS: '0', BACKUP_KEEP_DAILY: '-3' })
		).toMatchObject({ intervalMs: 24 * 60 * 60 * 1000, keepDaily: 7 });
	});
});
