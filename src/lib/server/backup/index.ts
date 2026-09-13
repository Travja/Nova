/**
 * Scheduled backups.
 *
 * Years of habits live in one file, and "run this command sometimes" is not a
 * backup strategy. The server takes its own snapshots on an interval and
 * rotates them, so a stock `docker compose up` is already backed up.
 *
 * This is not off-site storage: copy the snapshot directory somewhere else too.
 * `docs/DEPLOYMENT.md` covers that, and the restore procedure.
 */
import { logger } from '$lib/server/log';
import { dirname, join } from 'node:path';
import { createSnapshot, listSnapshots, removeSnapshots } from './snapshot';
import { planRetention } from './retention';

export interface BackupConfig {
	enabled: boolean;
	databaseFile: string;
	directory: string;
	intervalMs: number;
	keepDaily: number;
	keepWeekly: number;
}

const HOUR_MS = 60 * 60 * 1000;
/** Long enough to let the server finish booting and answer its first healthcheck. */
const FIRST_RUN_DELAY_MS = 30_000;

function fileFromUrl(url: string): string {
	return url.startsWith('file:') ? url.slice('file:'.length) : url;
}

function positiveNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function wholeNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Backups are on in production and off while developing, because a dev machine
 * does not need a rotating copy of its scratch database. `BACKUP_ENABLED`
 * overrides either way.
 */
export function readBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
	const databaseFile = fileFromUrl(env.DATABASE_URL ?? 'file:./data/nova.db');
	const explicit = env.BACKUP_ENABLED;
	const enabled =
		databaseFile !== ':memory:' &&
		(explicit === 'true' || (explicit !== 'false' && env.NODE_ENV === 'production'));

	return {
		enabled,
		databaseFile,
		// Next to the database by default, so the container's /data volume holds
		// both and a volume backup catches the snapshots too.
		directory: env.BACKUP_DIR ?? join(dirname(databaseFile), 'backups'),
		intervalMs: positiveNumber(env.BACKUP_INTERVAL_HOURS, 24) * HOUR_MS,
		keepDaily: wholeNumber(env.BACKUP_KEEP_DAILY, 7),
		keepWeekly: wholeNumber(env.BACKUP_KEEP_WEEKLY, 4)
	};
}

export interface BackupResult {
	snapshot: string;
	bytes: number;
	kept: number;
	removed: string[];
}

/** Takes one snapshot and applies the retention policy to the directory. */
export function runBackup(config: BackupConfig, now = new Date()): BackupResult {
	const snapshot = createSnapshot({
		sourceFile: config.databaseFile,
		directory: config.directory,
		now
	});

	const plan = planRetention(listSnapshots(config.directory), {
		keepDaily: config.keepDaily,
		keepWeekly: config.keepWeekly
	});
	const removed = removeSnapshots(
		config.directory,
		plan.remove.map((file) => file.name)
	);

	return { snapshot: snapshot.name, bytes: snapshot.bytes, kept: plan.keep.length, removed };
}

let timer: NodeJS.Timeout | undefined;

function backupNow(config: BackupConfig): void {
	try {
		const result = runBackup(config);
		logger.info('backup taken', { ...result, directory: config.directory });
	} catch (error) {
		// A failed backup is loud but never fatal: the app keeps serving.
		logger.error('backup failed', { directory: config.directory, error });
	}
}

/**
 * Starts the interval. Idempotent, and the timer is unref'd so it never holds
 * the process open on shutdown.
 *
 * The interval starts from launch, so a container that restarts more often than
 * the interval may never take one. Catching up on boot — snapshot immediately
 * when the newest one is older than the interval — is issue #29.
 */
export function startBackupSchedule(config: BackupConfig = readBackupConfig()): boolean {
	if (!config.enabled || timer) return false;

	logger.info('backup schedule started', {
		directory: config.directory,
		intervalHours: config.intervalMs / HOUR_MS,
		keepDaily: config.keepDaily,
		keepWeekly: config.keepWeekly
	});

	const first = setTimeout(() => backupNow(config), FIRST_RUN_DELAY_MS);
	first.unref?.();
	timer = setInterval(() => backupNow(config), config.intervalMs);
	timer.unref?.();
	return true;
}

export function stopBackupSchedule(): void {
	if (timer) clearInterval(timer);
	timer = undefined;
}
