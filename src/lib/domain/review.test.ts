import { describe, expect, it } from 'vitest';
import { fromZonedParts, periodFor, type PeriodOptions } from './period';
import { buildOrbit, snapshotGoal, type DormantWindow } from './progress';
import {
	daysOfYear,
	inReviewSeason,
	isPossible,
	longestFlight,
	notesInYear,
	orbitsInYear,
	periodYear,
	reviewYearFor,
	reviewYears,
	yearReview,
	yearSky,
	type ReviewGoalInput
} from './review';
import { periodsSinceLaunch } from './stats';
import { cadenceOf } from './tiers';
import type { Goal } from './types';

const utc: PeriodOptions = { timeZone: 'UTC' };
const denver: PeriodOptions = { timeZone: 'America/Denver' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Stretch',
		description: null,
		tier: 'satellite',
		metric: { kind: 'checkin', unit: '' },
		target: 1,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2025-01-01T00:00:00Z'),
		archivedAt: null,
		parentId: null,
		...overrides
	};
}

/** A wall-clock moment in `timeZone`, as the instant it names. */
function at(timeZone: string, year: number, month: number, day: number, hour = 12, minute = 0) {
	return fromZonedParts({ year, month, day, hour, minute, second: 0 }, timeZone);
}

/**
 * A goal's orbits the way the service builds them for the review: through
 * `snapshotGoal`, sized back to launch. Building them any other way would test
 * a history no screen ever hands over.
 */
function flown(
	g: Goal,
	occurred: readonly Date[],
	now: Date,
	options: PeriodOptions,
	dormantWindows: readonly DormantWindow[] = []
): ReviewGoalInput {
	const historyLength = periodsSinceLaunch(g.createdAt, now, cadenceOf(g.tier), options);
	const snapshot = snapshotGoal(
		g,
		occurred.map((occurredAt) => ({ amount: 1, occurredAt })),
		{ ...options, now, historyLength, dormantWindows }
	);
	return { goal: g, history: snapshot.history };
}

function inputs(goals: ReviewGoalInput[], extra: Partial<Parameters<typeof yearReview>[0]> = {}) {
	return { goals, notes: [], clearedAsteroids: [], ...extra };
}

describe('the year a period belongs to', () => {
	it('files the week spanning 31 December under the year it ends in', () => {
		// Monday 28 December 2026 to Sunday 3 January 2027.
		const week = periodFor(new Date('2026-12-30T12:00:00Z'), 'week', utc);
		expect(week.start.toISOString()).toBe('2026-12-28T00:00:00.000Z');
		expect(periodYear(week, 'UTC')).toBe(2027);

		const planet = goal({ tier: 'planet', createdAt: new Date('2026-12-01T00:00:00Z') });
		const now = new Date('2027-01-20T12:00:00Z');
		const flight = flown(planet, [new Date('2026-12-29T09:00:00Z')], now, utc);

		const in2026 = orbitsInYear(flight.history, 2026, 'UTC');
		const in2027 = orbitsInYear(flight.history, 2027, 'UTC');
		expect(in2026.map((orbit) => orbit.period.key)).not.toContain(week.key);
		expect(in2027.find((orbit) => orbit.period.key === week.key)?.complete).toBe(true);

		const review2026 = yearReview(inputs([flight]), 2026, utc, now);
		const review2027 = yearReview(inputs([flight]), 2027, utc, now);
		expect(review2026.headline.closed).toBe(0);
		expect(review2027.headline.closed).toBe(1);
		// It lights the day its period ended on, 3 January — not 28 December.
		expect(review2027.sky.days.find((day) => day.closed > 0)?.key).toBe('day:2027-01-03');
	});

	it('files a Universe orbit under its own year, not the one its exclusive end points into', () => {
		const universe = goal({ tier: 'universe', createdAt: new Date('2026-01-01T00:00:00Z') });
		const now = new Date('2027-01-05T12:00:00Z');
		const flight = flown(universe, [new Date('2026-07-01T12:00:00Z')], now, utc);

		const review = yearReview(inputs([flight]), 2026, utc, now);
		expect(review.universe).toEqual([
			{
				goalId: universe.id,
				title: universe.title,
				color: universe.color,
				status: 'closed',
				fraction: 1
			}
		]);
		expect(review.sky.days.find((day) => day.closed > 0)?.key).toBe('day:2026-12-31');
	});

	it('holds the year boundary in the user zone rather than UTC', () => {
		// 23:30 on New Year's Eve in Denver is already 2027 in UTC.
		const lateNight = at('America/Denver', 2026, 12, 31, 23, 30);
		expect(lateNight.toISOString().startsWith('2027-01-01')).toBe(true);

		const g = goal({ createdAt: at('America/Denver', 2026, 12, 1) });
		const now = at('America/Denver', 2027, 1, 10);
		const review = yearReview(inputs([flown(g, [lateNight], now, denver)]), 2026, denver, now);
		expect(review.headline.closed).toBe(1);
		expect(review.sky.days.find((day) => day.closed > 0)?.key).toBe('day:2026-12-31');
	});
});

describe('across daylight saving', () => {
	it('lays every day of the year once, whatever length the day is', () => {
		const days = daysOfYear(2026, denver);
		expect(days).toHaveLength(365);
		expect(days[0].key).toBe('day:2026-01-01');
		expect(days.at(-1)?.key).toBe('day:2026-12-31');

		const springForward = days.find((day) => day.key === 'day:2026-03-08');
		const fallBack = days.find((day) => day.key === 'day:2026-11-01');
		const hours = (period: { start: Date; end: Date }) =>
			(period.end.getTime() - period.start.getTime()) / 3_600_000;
		expect(springForward && hours(springForward)).toBe(23);
		expect(fallBack && hours(fallBack)).toBe(25);

		expect(daysOfYear(2028, denver)).toHaveLength(366);
	});

	it('counts the 23-hour and 25-hour days as one possible orbit each, on their own day', () => {
		const g = goal({ createdAt: at('America/Denver', 2026, 3, 7) });
		const now = at('America/Denver', 2026, 11, 2, 9);
		const flight = flown(
			g,
			[
				// The last hour of the short day, and the repeated hour of the long one.
				at('America/Denver', 2026, 3, 8, 23, 30),
				at('America/Denver', 2026, 11, 1, 23, 30)
			],
			now,
			denver
		);

		const review = yearReview(inputs([flight]), 2026, denver, now);
		const lit = review.sky.days.filter((day) => day.closed > 0).map((day) => day.key);
		expect(lit).toEqual(['day:2026-03-08', 'day:2026-11-01']);

		// 7 March through 1 November; 2 November is still in flight and open.
		const expectedDays =
			daysOfYear(2026, denver).findIndex((day) => day.key === 'day:2026-11-01') -
			daysOfYear(2026, denver).findIndex((day) => day.key === 'day:2026-03-07') +
			1;
		expect(review.headline).toMatchObject({ closed: 2, possible: expectedDays });
		expect(review.sky.days.find((day) => day.key === 'day:2026-11-03')?.future).toBe(true);
	});
});

describe('possible orbits', () => {
	it('leaves a dormant span out, and a flight carries across it', () => {
		const g = goal({ tier: 'planet', createdAt: new Date('2026-01-05T00:00:00Z') });
		const now = new Date('2026-03-02T12:00:00Z');
		// Weeks of 5, 12, 19 Jan closed; archived for the weeks of 26 Jan and
		// 2 Feb; back to close the weeks of 9, 16 and 23 Feb.
		const window = {
			from: new Date('2026-01-26T00:00:00Z'),
			until: new Date('2026-02-09T00:00:00Z')
		};
		const closes = [
			'2026-01-06',
			'2026-01-13',
			'2026-01-20',
			'2026-02-10',
			'2026-02-17',
			'2026-02-24'
		];
		const flight = flown(
			g,
			closes.map((day) => new Date(`${day}T12:00:00Z`)),
			now,
			utc,
			[window]
		);

		const review = yearReview(inputs([flight]), 2026, utc, now);
		// Eight weeks launched; two dormant; the week of 2 March is in flight.
		expect(review.headline).toMatchObject({ closed: 6, possible: 6 });
		expect(review.goals[0]).toMatchObject({ closed: 6, possible: 6, bestFlight: 6, standing: 1 });
		expect(review.longest?.flight).toEqual({
			length: 6,
			from: new Date('2026-01-05T00:00:00Z'),
			until: new Date('2026-03-01T23:59:59.999Z')
		});
	});

	it('starts at launch for a goal created mid-year', () => {
		const g = goal({ createdAt: at('America/Denver', 2026, 6, 15, 18) });
		const now = at('America/Denver', 2027, 1, 10);
		const flight = flown(g, [at('America/Denver', 2026, 6, 15, 19)], now, denver);

		const review = yearReview(inputs([flight]), 2026, denver, now);
		// 15 June to 31 December: 16 + 31 + 31 + 30 + 31 + 30 + 31.
		expect(review.headline).toMatchObject({ closed: 1, possible: 200 });
		expect(review.headline.byTier).toEqual([{ tier: 'satellite', closed: 1, possible: 200 }]);
	});

	it('does not count an orbit still in flight until it closes', () => {
		const period = periodFor(new Date('2026-05-10T12:00:00Z'), 'day', utc);
		const now = new Date('2026-05-10T13:00:00Z');
		expect(isPossible(buildOrbit(period, 0, 1), now)).toBe(false);
		expect(isPossible(buildOrbit(period, 1, 1), now)).toBe(true);
		expect(isPossible(buildOrbit(period, 1, 1, true), now)).toBe(false);
	});
});

describe('longestFlight', () => {
	it('breaks on a decided miss and keeps the first of two equal runs', () => {
		const days = ['01', '02', '03', '04', '05', '06', '07'].map((day) =>
			periodFor(new Date(`2026-04-${day}T12:00:00Z`), 'day', utc)
		);
		const logged = [1, 1, 0, 1, 1, 0, 1];
		const orbits = days.map((period, index) => buildOrbit(period, logged[index], 1));
		const flight = longestFlight(orbits, new Date('2026-05-01T00:00:00Z'));
		expect(flight).toEqual({
			length: 2,
			from: new Date('2026-04-01T00:00:00Z'),
			until: new Date('2026-04-02T23:59:59.999Z')
		});
		expect(longestFlight([], new Date())).toBeNull();
	});
});

describe('the rest of the page', () => {
	const now = new Date('2027-01-10T12:00:00Z');
	const satellite = goal({
		id: 'sat',
		title: 'Stretch',
		createdAt: new Date('2025-11-01T00:00:00Z')
	});
	const planet = goal({
		id: 'pla',
		title: 'Long run',
		tier: 'planet',
		createdAt: new Date('2026-01-01T00:00:00Z')
	});

	it('orders the notes of the year by the period they were written for', () => {
		const goals = [flown(satellite, [], now, utc), flown(planet, [], now, utc)];
		const notes = notesInYear(
			[
				{ goalId: 'sat', periodStart: new Date('2026-03-03T00:00:00Z'), body: 'Later' },
				{ goalId: 'pla', periodStart: new Date('2026-12-28T00:00:00Z'), body: 'Next year' },
				{ goalId: 'sat', periodStart: new Date('2025-12-31T00:00:00Z'), body: 'Last year' },
				{ goalId: 'pla', periodStart: new Date('2026-03-02T00:00:00Z'), body: 'Week' },
				{ goalId: 'sat', periodStart: new Date('2026-03-08T00:00:00Z'), body: 'Day' },
				{ goalId: 'gone', periodStart: new Date('2026-06-01T00:00:00Z'), body: 'Orphan' }
			],
			goals,
			2026,
			utc
		);
		// The week of 2 March ends on 8 March, alongside the day; the day reads first.
		expect(notes.map((note) => note.body)).toEqual(['Later', 'Day', 'Week']);
	});

	it('puts last year beside this one only when last year has something', () => {
		const goals = [
			flown(
				satellite,
				[new Date('2025-11-03T09:00:00Z'), new Date('2026-02-01T09:00:00Z')],
				now,
				utc
			)
		];
		const cleared = [new Date('2026-05-01T12:00:00Z'), new Date('2025-12-01T12:00:00Z')];
		const review = yearReview(inputs(goals, { clearedAsteroids: cleared }), 2026, utc, now);
		expect(review.asteroidsCleared).toBe(1);
		expect(review.lastYear).toMatchObject({
			year: 2025,
			closed: 1,
			possible: 61,
			longestFlight: 1,
			asteroidsCleared: 1
		});

		const first = yearReview(inputs(goals), 2025, utc, now);
		expect(first.lastYear).toBeNull();
	});

	it('says a year with nothing in it has no data', () => {
		const review = yearReview(inputs([flown(planet, [], now, utc)]), 2019, utc, now);
		expect(review.hasData).toBe(false);
		expect(review.goals).toEqual([]);
		expect(review.sky.days).toHaveLength(365);
		expect(review.sky.brightest).toBe(0);
	});

	it('lays the sky with the history heatmap layout, Sunday rows', () => {
		const sky = yearSky([], 2026, utc, now);
		// 1 January 2026 is a Thursday; 2026 needs 53 columns.
		expect(sky.days[0]).toMatchObject({ key: 'day:2026-01-01', week: 0, weekday: 4 });
		expect(sky.weeks).toBe(53);
	});
});

describe('the review season', () => {
	it('runs from 26 December to 31 January in the user zone', () => {
		expect(inReviewSeason(at('America/Denver', 2026, 12, 25, 23, 59), 'America/Denver')).toBe(
			false
		);
		expect(inReviewSeason(at('America/Denver', 2026, 12, 26, 0, 0), 'America/Denver')).toBe(true);
		expect(inReviewSeason(at('America/Denver', 2027, 1, 31, 23, 59), 'America/Denver')).toBe(true);
		expect(inReviewSeason(at('America/Denver', 2027, 2, 1, 0, 0), 'America/Denver')).toBe(false);
		// Already 26 December in UTC, still Christmas evening in Denver.
		expect(inReviewSeason(at('America/Denver', 2026, 12, 25, 20), 'America/Denver')).toBe(false);
	});

	it('reviews last year through January, and this year so far after that', () => {
		expect(reviewYearFor(at('UTC', 2027, 1, 15), 'UTC')).toBe(2026);
		expect(reviewYearFor(at('UTC', 2026, 12, 28), 'UTC')).toBe(2026);
		expect(reviewYearFor(at('UTC', 2026, 10, 27), 'UTC')).toBe(2026);
	});

	it('lists every year since the first launch, newest first', () => {
		expect(reviewYears(new Date('2024-06-01T00:00:00Z'), at('UTC', 2026, 10, 27), 'UTC')).toEqual([
			2026, 2025, 2024
		]);
		expect(reviewYears(null, new Date(), 'UTC')).toEqual([]);
	});
});
