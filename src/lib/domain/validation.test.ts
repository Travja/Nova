import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_MS, entrySchemaFor, occurredAtBounds } from './validation';

const now = new Date('2026-09-12T18:00:00Z');
const utc = { timeZone: 'UTC' };

describe('occurredAtBounds', () => {
	it('reaches back to the start of the orbit the goal launched in', () => {
		// A Planet goal added on Wednesday can still take Monday's work.
		const bounds = occurredAtBounds(
			{ tier: 'planet', createdAt: new Date('2026-09-09T15:00:00Z') },
			utc,
			now
		);
		expect(bounds.earliest.toISOString()).toBe('2026-09-07T00:00:00.000Z');
		expect(bounds.earliestLabel).toBe('the week of 7 Sept');
	});

	it('scales the floor to the tier, not to a fixed number of days', () => {
		const created = { createdAt: new Date('2026-09-09T15:00:00Z') };
		expect(
			occurredAtBounds({ ...created, tier: 'satellite' }, utc, now).earliest.toISOString()
		).toBe('2026-09-09T00:00:00.000Z');
		expect(
			occurredAtBounds({ ...created, tier: 'universe' }, utc, now).earliest.toISOString()
		).toBe('2026-01-01T00:00:00.000Z');
	});

	it('forgives a slightly fast clock', () => {
		const bounds = occurredAtBounds({ tier: 'planet', createdAt: now }, utc, now);
		expect(bounds.latest.getTime() - now.getTime()).toBe(CLOCK_SKEW_MS);
	});
});

describe('entrySchemaFor', () => {
	const bounds = occurredAtBounds(
		{ tier: 'satellite', createdAt: new Date('2026-03-01T12:00:00Z') },
		{ timeZone: 'America/Denver' },
		new Date('2026-03-08T20:00:00Z')
	);

	it('reads a datetime-local value in the user zone', () => {
		const parsed = entrySchemaFor(bounds).parse({ amount: '30', occurredAt: '2026-03-08T09:00' });
		// 09:00 in Denver on daylight time is 15:00 UTC, not 09:00 UTC.
		expect(parsed.occurredAt?.toISOString()).toBe('2026-03-08T15:00:00.000Z');
	});

	it('treats an empty field as "now", which the service fills in', () => {
		expect(
			entrySchemaFor(bounds).parse({ amount: '30', occurredAt: '' }).occurredAt
		).toBeUndefined();
		expect(entrySchemaFor(bounds).parse({ amount: '30' }).occurredAt).toBeUndefined();
	});

	it('rejects a timestamp beyond the clock-skew allowance', () => {
		const result = entrySchemaFor(bounds).safeParse({
			amount: '30',
			occurredAt: '2026-03-09T09:00'
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].message).toMatch(/future/);
	});

	it('rejects a timestamp from before the goal launched', () => {
		const result = entrySchemaFor(bounds).safeParse({
			amount: '30',
			occurredAt: '2026-02-27T09:00'
		});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0].message).toMatch(/when this goal launched/);
	});

	it('rejects a value it cannot read as a date', () => {
		expect(entrySchemaFor(bounds).safeParse({ amount: '30', occurredAt: 'soon' }).success).toBe(
			false
		);
	});

	it('parses without bounds, which is what quick-logging needs', () => {
		expect(entrySchemaFor().parse({ amount: '5' })).toMatchObject({ amount: 5, note: null });
	});
});
