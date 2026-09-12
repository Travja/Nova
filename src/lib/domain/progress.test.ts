import { describe, expect, it } from 'vitest';
import { periodFor } from './period';
import { buildOrbit, formatAmount, snapshotGoal, streakFrom } from './progress';
import type { Goal } from './types';

const options = { timeZone: 'UTC', now: new Date('2026-09-12T18:00:00Z') };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Clean the house',
		description: null,
		tier: 'planet',
		metric: { kind: 'duration', unit: 'minutes' },
		target: 120,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		archivedAt: null,
		...overrides
	};
}

function entry(iso: string, amount: number) {
	return { amount, occurredAt: new Date(iso) };
}

describe('buildOrbit', () => {
	it('maps progress onto an arc angle', () => {
		const period = periodFor(options.now, 'week', options);
		const orbit = buildOrbit(period, 30, 120);
		expect(orbit.fraction).toBeCloseTo(0.25);
		expect(orbit.angle).toBeCloseTo(90);
		expect(orbit.remaining).toBe(90);
		expect(orbit.complete).toBe(false);
	});

	it('clamps the arc but keeps the raw ratio when a target is overshot', () => {
		const period = periodFor(options.now, 'week', options);
		const orbit = buildOrbit(period, 180, 120);
		expect(orbit.ratio).toBeCloseTo(1.5);
		expect(orbit.fraction).toBe(1);
		expect(orbit.angle).toBe(360);
		expect(orbit.remaining).toBe(0);
		expect(orbit.complete).toBe(true);
	});

	it('does not divide by zero when a target is missing', () => {
		const period = periodFor(options.now, 'week', options);
		expect(buildOrbit(period, 5, 0).ratio).toBe(5);
	});
});

describe('snapshotGoal', () => {
	it('sums only the entries inside each orbit', () => {
		const snapshot = snapshotGoal(
			goal(),
			[
				entry('2026-09-12T10:00:00Z', 45), // this week
				entry('2026-09-07T08:00:00Z', 30), // Monday, still this week
				entry('2026-09-06T23:00:00Z', 60) // last week
			],
			options
		);
		expect(snapshot.current.logged).toBe(75);
		expect(snapshot.history[1].logged).toBe(60);
		expect(snapshot.lifetimeLogged).toBe(135);
	});

	it('counts an open orbit as neither closed nor broken', () => {
		const snapshot = snapshotGoal(
			goal(),
			[
				entry('2026-09-12T10:00:00Z', 30), // this week, short of target
				entry('2026-09-03T10:00:00Z', 120), // last week, closed
				entry('2026-08-27T10:00:00Z', 120) // week before, closed
			],
			options
		);
		expect(snapshot.current.complete).toBe(false);
		expect(snapshot.streak).toBe(2);
		expect(snapshot.totalOrbits).toBe(2);
	});

	it('includes a closed in-flight orbit in the streak', () => {
		const snapshot = snapshotGoal(
			goal(),
			[entry('2026-09-12T10:00:00Z', 150), entry('2026-09-03T10:00:00Z', 120)],
			options
		);
		expect(snapshot.streak).toBe(2);
	});

	it('applies the tier cadence rather than a fixed window', () => {
		const daily = snapshotGoal(goal({ tier: 'satellite', target: 20 }), [], options);
		expect(daily.current.period.cadence).toBe('day');
		const yearly = snapshotGoal(goal({ tier: 'universe', target: 12 }), [], options);
		expect(yearly.current.period.cadence).toBe('year');
	});

	it('lets negative entries correct an over-log', () => {
		const snapshot = snapshotGoal(
			goal(),
			[entry('2026-09-12T10:00:00Z', 150), entry('2026-09-12T11:00:00Z', -60)],
			options
		);
		expect(snapshot.current.logged).toBe(90);
		expect(snapshot.current.complete).toBe(false);
	});
});

describe('streakFrom', () => {
	it('stops at the first missed closed orbit', () => {
		const period = periodFor(options.now, 'week', options);
		const history = [1, 1, 0, 1].map((ratio) => buildOrbit(period, ratio * 120, 120));
		expect(streakFrom(history)).toBe(2);
	});

	it('is zero when nothing has closed', () => {
		const period = periodFor(options.now, 'week', options);
		expect(streakFrom([buildOrbit(period, 10, 120)])).toBe(0);
	});
});

describe('formatAmount', () => {
	it('renders durations in hours and minutes', () => {
		expect(formatAmount(90, { kind: 'duration', unit: 'minutes' })).toBe('1h 30m');
		expect(formatAmount(120, { kind: 'duration', unit: 'minutes' })).toBe('2h');
		expect(formatAmount(45, { kind: 'duration', unit: 'minutes' })).toBe('45m');
	});

	it('pluralises check-ins and keeps counted units', () => {
		expect(formatAmount(1, { kind: 'checkin', unit: '' })).toBe('1 check-in');
		expect(formatAmount(3, { kind: 'checkin', unit: '' })).toBe('3 check-ins');
		expect(formatAmount(12, { kind: 'count', unit: 'pages' })).toBe('12 pages');
	});
});
