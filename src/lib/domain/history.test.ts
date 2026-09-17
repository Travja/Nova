import { describe, expect, it } from 'vitest';
import {
	dayGrid,
	detailsFromClosures,
	detailsFromEntries,
	historyCells,
	type HistoryCell
} from './history';
import { parentPeriodFor } from './nesting';
import { periodFor, recentPeriods } from './period';
import { buildOrbit, type Orbit } from './progress';

const utc = { timeZone: 'UTC' };
const denver = { timeZone: 'America/Denver' };

function orbit(
	period: ReturnType<typeof periodFor>,
	logged = 0,
	target = 1,
	dormant = false
): Orbit {
	return buildOrbit(period, logged, target, dormant);
}

describe('historyCells', () => {
	it('pairs each orbit with the details keyed to its period, and leaves the rest empty', () => {
		const now = new Date('2026-09-20T12:00:00Z');
		const history = recentPeriods(now, 'week', 3, utc).map((period) => orbit(period, 1));
		const details = new Map([[history[1].period.key, [{ label: 'note', amount: 1, at: now }]]]);

		const cells = historyCells(history, details);

		expect(cells).toHaveLength(3);
		expect(cells[0].details).toEqual([]);
		expect(cells[1].details).toEqual([{ label: 'note', amount: 1, at: now }]);
		expect(cells[2].details).toEqual([]);
	});
});

describe('detailsFromEntries', () => {
	it('buckets entries by the period they occurred in, carrying the note and amount', () => {
		const buckets = detailsFromEntries(
			[
				{ amount: 2, note: 'morning run', occurredAt: new Date('2026-09-14T12:00:00Z') },
				{ amount: 3, note: null, occurredAt: new Date('2026-09-14T18:00:00Z') },
				{ amount: 1, note: null, occurredAt: new Date('2026-09-15T18:00:00Z') }
			],
			'day',
			utc
		);

		expect(buckets.get('day:2026-09-14')).toEqual([
			{ label: 'morning run', amount: 2, at: new Date('2026-09-14T12:00:00Z') },
			{ label: null, amount: 3, at: new Date('2026-09-14T18:00:00Z') }
		]);
		expect(buckets.get('day:2026-09-15')).toEqual([
			{ label: null, amount: 1, at: new Date('2026-09-15T18:00:00Z') }
		]);
	});
});

describe('detailsFromClosures', () => {
	it('lists a child under the same parent period parentPeriodFor would count it toward', () => {
		// The straddling week from nesting.test.ts: six days in October, finishes
		// in November, so it belongs to November even though it opened in October.
		const week = periodFor(new Date('2026-10-28T18:00:00Z'), 'week', denver);
		expect(parentPeriodFor(week, 'month', denver).key).toBe('month:2026-11');

		const buckets = detailsFromClosures(
			[{ title: 'Weekly run', periods: [week] }],
			'month',
			denver
		);

		expect(buckets.get('month:2026-11')).toEqual([
			{ label: 'Weekly run', amount: 1, at: week.end }
		]);
		expect(buckets.has('month:2026-10')).toBe(false);
	});

	it('lists every child closure under its own detail, even when several land in the same cell', () => {
		const now = new Date('2026-09-20T12:00:00Z');
		const week = periodFor(now, 'week', utc);

		const buckets = detailsFromClosures(
			[
				{ title: 'Reading', periods: [week] },
				{ title: 'Running', periods: [week] }
			],
			'month',
			utc
		);

		const key = parentPeriodFor(week, 'month', utc).key;
		expect(buckets.get(key)?.map((detail) => detail.label)).toEqual(['Reading', 'Running']);
	});
});

describe('dayGrid', () => {
	it('keeps the same week until the day wraps past Saturday', () => {
		// 14–20 September 2026 is Monday through Sunday.
		const days = ['14', '15', '16', '17', '18', '19', '20'].map((day) =>
			periodFor(new Date(`2026-09-${day}T12:00:00Z`), 'day', utc)
		);
		const cells: HistoryCell[] = days.map((period) => ({ orbit: orbit(period, 1), details: [] }));

		const grid = dayGrid(cells, 'UTC');

		expect(grid.map((cell) => cell.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(grid.map((cell) => cell.week)).toEqual([0, 0, 0, 0, 0, 0, 1]);
	});

	it('places days by their local weekday across a daylight saving transition', () => {
		// 8 March 2026 is the DST-shortened day in America/Denver. The days
		// either side of it still land on their own real weekdays.
		const days = ['06', '07', '08', '09'].map((day) =>
			periodFor(new Date(`2026-03-${day}T12:00:00Z`), 'day', denver)
		);
		const cells: HistoryCell[] = days.map((period) => ({ orbit: orbit(period, 1), details: [] }));

		const grid = dayGrid(cells, 'America/Denver');

		// 6 March 2026 is a Friday.
		expect(grid.map((cell) => cell.weekday)).toEqual([5, 6, 0, 1]);
		expect(grid.map((cell) => cell.week)).toEqual([0, 0, 1, 1]);
	});
});
