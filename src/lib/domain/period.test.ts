import { describe, expect, it } from 'vitest';
import { addPeriods, periodFor, previousPeriod, recentPeriods, zonedParts } from './period';

const denver = { timeZone: 'America/Denver' };
const utc = { timeZone: 'UTC' };

describe('periodFor', () => {
	it('starts a day at local midnight, not UTC midnight', () => {
		// 2026-03-10T03:00Z is still 21:00 on 2026-03-09 in Denver, which is on
		// daylight time (UTC-6) by then.
		const period = periodFor(new Date('2026-03-10T03:00:00Z'), 'day', denver);
		expect(period.key).toBe('day:2026-03-09');
		expect(period.start.toISOString()).toBe('2026-03-09T06:00:00.000Z');
		expect(period.end.toISOString()).toBe('2026-03-10T06:00:00.000Z');
	});

	it('keeps a day 23 hours long across a spring-forward transition', () => {
		// US DST starts 2026-03-08.
		const period = periodFor(new Date('2026-03-08T12:00:00Z'), 'day', denver);
		const hours = (period.end.getTime() - period.start.getTime()) / 3_600_000;
		expect(hours).toBe(23);
	});

	it('keeps a day 25 hours long across a fall-back transition', () => {
		// US DST ends 2026-11-01.
		const period = periodFor(new Date('2026-11-01T12:00:00Z'), 'day', denver);
		const hours = (period.end.getTime() - period.start.getTime()) / 3_600_000;
		expect(hours).toBe(25);
	});

	it('anchors weeks to Monday by default and keys them by ISO week', () => {
		const period = periodFor(new Date('2026-09-12T18:00:00Z'), 'week', utc);
		expect(period.key).toBe('week:2026-W37');
		expect(zonedParts(period.start, 'UTC').day).toBe(7);
		expect(period.end.getTime() - period.start.getTime()).toBe(7 * 86_400_000);
	});

	it('honours a Sunday week start', () => {
		const period = periodFor(new Date('2026-09-12T18:00:00Z'), 'week', {
			timeZone: 'UTC',
			weekStartsOn: 0
		});
		expect(zonedParts(period.start, 'UTC').day).toBe(6);
		expect(period.key).toBe('week:2026-09-06');
	});

	it('bounds months, quarters and years on their first day', () => {
		const instant = new Date('2026-08-17T09:30:00Z');
		expect(periodFor(instant, 'month', utc).key).toBe('month:2026-08');
		expect(periodFor(instant, 'quarter', utc).key).toBe('quarter:2026-Q3');
		expect(periodFor(instant, 'year', utc).key).toBe('year:2026');
		expect(periodFor(instant, 'quarter', utc).start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
		expect(periodFor(instant, 'quarter', utc).end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
	});

	it('treats the last instant of a period as inside it', () => {
		const period = periodFor(new Date('2026-09-12T18:00:00Z'), 'month', utc);
		const lastInstant = new Date(period.end.getTime() - 1);
		expect(periodFor(lastInstant, 'month', utc).key).toBe(period.key);
		expect(periodFor(period.end, 'month', utc).key).toBe('month:2026-10');
	});
});

describe('addPeriods', () => {
	it('does not roll a month-end date into the following month', () => {
		const shifted = addPeriods(new Date('2026-01-31T00:00:00Z'), 'month', 1, utc);
		expect(shifted.toISOString()).toBe('2026-02-28T00:00:00.000Z');
	});

	it('steps backwards across a year boundary', () => {
		const shifted = addPeriods(new Date('2026-01-15T00:00:00Z'), 'month', -2, utc);
		expect(shifted.toISOString()).toBe('2025-11-15T00:00:00.000Z');
	});
});

describe('recentPeriods', () => {
	it('walks backwards without gaps or repeats', () => {
		const periods = recentPeriods(new Date('2026-09-12T18:00:00Z'), 'week', 5, utc);
		expect(periods.map((period) => period.key)).toEqual([
			'week:2026-W37',
			'week:2026-W36',
			'week:2026-W35',
			'week:2026-W34',
			'week:2026-W33'
		]);
		for (let index = 1; index < periods.length; index += 1) {
			expect(periods[index].end.getTime()).toBe(periods[index - 1].start.getTime());
		}
	});

	it('steps back correctly across a DST boundary', () => {
		const periods = recentPeriods(new Date('2026-11-03T12:00:00Z'), 'day', 4, denver);
		expect(periods.map((period) => period.key)).toEqual([
			'day:2026-11-03',
			'day:2026-11-02',
			'day:2026-11-01',
			'day:2026-10-31'
		]);
	});

	it('previousPeriod is the inverse of moving forward', () => {
		const period = periodFor(new Date('2026-01-01T00:30:00Z'), 'quarter', utc);
		expect(previousPeriod(period, utc).key).toBe('quarter:2025-Q4');
	});
});
