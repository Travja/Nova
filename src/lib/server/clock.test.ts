import { describe, expect, it } from 'vitest';
import { clockOverride } from './clock';

/**
 * The parsing half of the clock seam. Whether it is consulted at all is
 * `hooks.server.ts`'s business, and in a production build that call is gone.
 */
describe('clockOverride', () => {
	const denver = 'America/Denver';
	/** Mid-afternoon in Denver on an ordinary day. */
	const now = new Date('2026-09-12T20:00:00Z');

	it('moves the hour and keeps the day, in the user’s own zone', () => {
		// 21:00 Denver on 12 September is 03:00 UTC on the 13th.
		expect(clockOverride('21:00', denver, now)?.toISOString()).toBe('2026-09-13T03:00:00.000Z');
		expect(clockOverride('06:30', denver, now)?.toISOString()).toBe('2026-09-12T12:30:00.000Z');
	});

	it('reads the same time differently in a different zone', () => {
		expect(clockOverride('21:00', 'UTC', now)?.toISOString()).toBe('2026-09-12T21:00:00.000Z');
	});

	it('lands on the right instant across a daylight saving transition', () => {
		// 8 March 2026 is 23 hours long in Denver: 21:00 is MDT, an hour closer to
		// UTC than the same wall clock the evening before.
		const spring = new Date('2026-03-08T20:00:00Z');
		expect(clockOverride('21:00', denver, spring)?.toISOString()).toBe('2026-03-09T03:00:00.000Z');
		const before = new Date('2026-03-07T20:00:00Z');
		expect(clockOverride('21:00', denver, before)?.toISOString()).toBe('2026-03-08T04:00:00.000Z');
	});

	it('takes a full wall-clock date, for a test that needs another period', () => {
		expect(clockOverride('2026-10-01T21:00', denver, now)?.toISOString()).toBe(
			'2026-10-02T03:00:00.000Z'
		);
	});

	it('ignores anything it does not recognise', () => {
		for (const value of [null, undefined, '', '   ', '25:00', '9:00', 'tomorrow', '2026-10-01']) {
			expect(clockOverride(value, denver, now)).toBeNull();
		}
	});

	it('trims, since a cookie is typed by hand as often as not', () => {
		expect(clockOverride('  21:00  ', 'UTC', now)?.toISOString()).toBe('2026-09-12T21:00:00.000Z');
	});
});
