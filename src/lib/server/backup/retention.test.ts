import { describe, expect, it } from 'vitest';
import { dayKey, planRetention, weekKey, type SnapshotFile } from './retention';

const DAY_MS = 86_400_000;

/** One snapshot a day at 03:00 UTC, counting back from `last`. */
function daily(last: string, count: number): SnapshotFile[] {
	const end = Date.parse(last);
	return Array.from({ length: count }, (_, index) => {
		const takenAt = end - index * DAY_MS;
		return { name: new Date(takenAt).toISOString(), takenAt };
	});
}

describe('weekKey', () => {
	it('numbers ISO weeks, with the year that owns the Thursday', () => {
		expect(weekKey(Date.parse('2026-09-13T03:00:00Z'))).toBe('2026-W37');
		expect(weekKey(Date.parse('2026-09-14T03:00:00Z'))).toBe('2026-W38');
		// 1 January 2027 is a Friday, so it belongs to the last week of 2026.
		expect(weekKey(Date.parse('2027-01-01T03:00:00Z'))).toBe('2026-W53');
		expect(weekKey(Date.parse('2026-01-01T03:00:00Z'))).toBe('2026-W01');
	});
});

describe('planRetention', () => {
	it('keeps the last N days and M weeks, and drops the rest', () => {
		const files = daily('2026-09-13T03:00:00Z', 60);
		const { keep, remove } = planRetention(files, { keepDaily: 7, keepWeekly: 4 });

		expect(keep).toHaveLength(10);
		expect(keep.length + remove.length).toBe(files.length);
		expect(new Set(keep.map((file) => file.name)).size).toBe(keep.length);

		const days = keep.slice(0, 7).map((file) => dayKey(file.takenAt));
		expect(days).toEqual([
			'2026-09-13',
			'2026-09-12',
			'2026-09-11',
			'2026-09-10',
			'2026-09-09',
			'2026-09-08',
			'2026-09-07'
		]);
	});

	it('counts a snapshot that is both the day and the week winner once', () => {
		const files = daily('2026-09-13T03:00:00Z', 10);
		const { keep } = planRetention(files, { keepDaily: 7, keepWeekly: 2 });
		// Seven daily (Mon–Sun, one full ISO week) plus the previous week’s newest.
		expect(keep).toHaveLength(8);
	});

	it('keeps only the newest snapshot of a day when several were taken', () => {
		const files: SnapshotFile[] = [
			{ name: 'morning', takenAt: Date.parse('2026-09-13T03:00:00Z') },
			{ name: 'noon', takenAt: Date.parse('2026-09-13T12:00:00Z') },
			{ name: 'evening', takenAt: Date.parse('2026-09-13T21:00:00Z') }
		];
		const { keep, remove } = planRetention(files, { keepDaily: 7, keepWeekly: 0 });
		expect(keep.map((file) => file.name)).toEqual(['evening']);
		expect(remove.map((file) => file.name)).toEqual(['noon', 'morning']);
	});

	it('keeps a weekly snapshot older than the daily window', () => {
		const files = daily('2026-09-13T03:00:00Z', 30);
		const { keep } = planRetention(files, { keepDaily: 2, keepWeekly: 4 });
		const weeks = keep.map((file) => weekKey(file.takenAt));
		expect(new Set(weeks)).toEqual(new Set(['2026-W37', '2026-W36', '2026-W35', '2026-W34']));
		expect(Math.min(...keep.map((file) => file.takenAt))).toBeLessThan(
			Date.parse('2026-09-11T03:00:00Z')
		);
	});

	it('never removes everything when the policy is empty, it removes exactly everything', () => {
		const files = daily('2026-09-13T03:00:00Z', 3);
		const { keep, remove } = planRetention(files, { keepDaily: 0, keepWeekly: 0 });
		expect(keep).toEqual([]);
		expect(remove).toHaveLength(3);
	});

	it('handles a directory with nothing in it', () => {
		expect(planRetention([], { keepDaily: 7, keepWeekly: 4 })).toEqual({ keep: [], remove: [] });
	});
});
