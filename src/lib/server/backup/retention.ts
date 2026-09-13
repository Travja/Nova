/**
 * Which snapshots to keep.
 *
 * Pure functions over a list of {name, takenAt} — no filesystem — so the
 * rotation rule can be tested exhaustively without writing a single file.
 *
 * Buckets are UTC. Unlike a goal's orbits, which are drawn in the user's own
 * time zone, a backup schedule belongs to the server: an instance whose users
 * span three time zones still keeps one snapshot per server day.
 */

export interface SnapshotFile {
	name: string;
	/** Epoch milliseconds the snapshot was taken. */
	takenAt: number;
}

export interface RetentionPolicy {
	/** Newest snapshot of each of the last N days. */
	keepDaily: number;
	/** Newest snapshot of each of the last M ISO weeks. */
	keepWeekly: number;
}

export interface RetentionPlan {
	keep: SnapshotFile[];
	remove: SnapshotFile[];
}

export function dayKey(takenAt: number): string {
	return new Date(takenAt).toISOString().slice(0, 10);
}

/** ISO-8601 week key, e.g. `2026-W37`. Weeks start Monday and belong to the year holding their Thursday. */
export function weekKey(takenAt: number): string {
	const date = new Date(takenAt);
	const thursday = Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3
	);
	const year = new Date(thursday).getUTCFullYear();
	const firstThursday = Date.UTC(year, 0, 4);
	const offset = (new Date(firstThursday).getUTCDay() + 6) % 7;
	const week = Math.round((thursday - (firstThursday - offset * 86400000)) / (7 * 86400000)) + 1;
	return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Keeps the newest snapshot of each of the last `keepDaily` days and of each of
 * the last `keepWeekly` weeks; everything else is removable. A snapshot can
 * satisfy both rules, which is why the two sets are unioned rather than summed.
 */
export function planRetention(files: SnapshotFile[], policy: RetentionPolicy): RetentionPlan {
	const newestFirst = [...files].sort(
		(a, b) => b.takenAt - a.takenAt || a.name.localeCompare(b.name)
	);

	const kept = new Set<string>();
	const claim = (bucket: (takenAt: number) => string, limit: number) => {
		const seen = new Set<string>();
		for (const file of newestFirst) {
			if (seen.size >= limit) break;
			const key = bucket(file.takenAt);
			if (seen.has(key)) continue;
			seen.add(key);
			kept.add(file.name);
		}
	};

	claim(dayKey, Math.max(0, policy.keepDaily));
	claim(weekKey, Math.max(0, policy.keepWeekly));

	return {
		keep: newestFirst.filter((file) => kept.has(file.name)),
		remove: newestFirst.filter((file) => !kept.has(file.name))
	};
}
