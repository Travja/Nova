import { describe, expect, it } from 'vitest';
import { snapshotDerivedGoal, type ChildInput } from './nesting';
import { periodFor, previousPeriod, type PeriodOptions } from './period';
import { buildOrbit, type Orbit } from './progress';
import {
	averageMomentum,
	bestStreak,
	completionByTier,
	goalStreaks,
	loggingRhythm,
	momentumFor,
	overallCompletion,
	periodsSinceLaunch,
	topMomentum,
	type MomentumInput
} from './stats';
import type { Goal } from './types';

const utc: PeriodOptions = { timeZone: 'UTC' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Read pages',
		description: null,
		tier: 'planet',
		metric: { kind: 'count', unit: 'pages' },
		target: 2,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2025-01-01T00:00:00Z'),
		archivedAt: null,
		parentId: null,
		...overrides
	};
}

function entry(iso: string, amount = 1) {
	return { amount, occurredAt: new Date(iso) };
}

/**
 * A run of weekly orbits, newest first, built from a hand-written plan so a
 * test can say in one line what each week did rather than reconstruct it from
 * entries. `now` anchors the newest (in-flight) orbit.
 */
function weeklyOrbits(
	now: Date,
	plan: readonly { logged: number; dormant?: boolean }[],
	target = 1
): Orbit[] {
	const orbits: Orbit[] = [];
	let period = periodFor(now, 'week', utc);
	for (const step of plan) {
		orbits.push(buildOrbit(period, step.logged, target, step.dormant ?? false));
		period = previousPeriod(period, utc);
	}
	return orbits;
}

describe('bestStreak', () => {
	it('finds the longest run ever, bridging a dormant span, even when it is not the current streak', () => {
		// Newest first: in flight, a miss, four closes with a dormant week
		// bridged in the middle, another miss, then one more close.
		const history = weeklyOrbits(new Date('2026-09-12T18:00:00Z'), [
			{ logged: 0 }, // in flight — not a miss yet
			{ logged: 0 }, // miss — breaks the live streak at zero
			{ logged: 1 },
			{ logged: 1 },
			{ logged: 0, dormant: true }, // archived that week — never flown
			{ logged: 1 },
			{ logged: 1 }, // the run of four: two closes either side of the gap
			{ logged: 0 }, // miss — ends the run
			{ logged: 1 }
		]);

		expect(bestStreak(history)).toBe(4);
	});

	it('does not count the orbit still in flight as part of a run', () => {
		const history = weeklyOrbits(new Date('2026-09-12T18:00:00Z'), [
			{ logged: 1 }, // in flight, already past target, but the period is not over
			{ logged: 1 },
			{ logged: 1 }
		]);
		// The in-flight orbit is genuinely complete this time, so it does extend
		// the run — the exemption above only applies while it is still short.
		expect(bestStreak(history)).toBe(3);
	});
});

describe('goalStreaks', () => {
	it('reports current and best separately, best-first', () => {
		const now = new Date('2026-09-12T18:00:00Z');
		const brokenButProven = weeklyOrbits(now, [
			{ logged: 0 },
			{ logged: 0 },
			{ logged: 1 },
			{ logged: 1 },
			{ logged: 1 },
			{ logged: 1 }
		]);
		const shortButLive = weeklyOrbits(now, [{ logged: 0 }, { logged: 1 }, { logged: 1 }]);

		const rows = goalStreaks([
			{ goalId: 'a', title: 'Broken but proven', tier: 'planet', history: brokenButProven },
			{ goalId: 'b', title: 'Short but live', tier: 'satellite', history: shortButLive }
		]);

		expect(rows[0]).toMatchObject({ goalId: 'a', current: 0, best: 4 });
		expect(rows[1]).toMatchObject({ goalId: 'b', current: 2, best: 2 });
	});
});

describe('completionByTier', () => {
	const now = new Date('2026-09-12T18:00:00Z');

	it('drops dormant and in-flight periods from the denominator and skips tiers with no decided history', () => {
		// Planet: in flight (excluded), a dormant week (excluded), then 5
		// decided weeks — 3 closed, 2 missed.
		const planetHistory = weeklyOrbits(now, [
			{ logged: 0 },
			{ logged: 0, dormant: true },
			{ logged: 1 },
			{ logged: 1 },
			{ logged: 1 },
			{ logged: 0 },
			{ logged: 0 }
		]);
		// Satellite: a single decided, closed week.
		const satelliteHistory = weeklyOrbits(now, [{ logged: 0 }, { logged: 1 }]);
		// Universe: only the in-flight orbit exists — no decided history yet.
		const universeHistory = weeklyOrbits(now, [{ logged: 0 }]);

		const tiers = completionByTier(
			[
				{ tier: 'planet', history: planetHistory },
				{ tier: 'satellite', history: satelliteHistory },
				{ tier: 'universe', history: universeHistory }
			],
			now
		);

		expect(tiers).toEqual([
			{ tier: 'satellite', closed: 1, decided: 1, rate: 1 },
			{ tier: 'planet', closed: 3, decided: 5, rate: 0.6 }
		]);
	});

	it('sums to an overall rate across tiers', () => {
		const tiers = completionByTier(
			[
				{
					tier: 'planet',
					history: weeklyOrbits(now, [{ logged: 0 }, { logged: 1 }, { logged: 0 }])
				}
			],
			now
		);
		expect(overallCompletion(tiers)).toEqual({ closed: 1, decided: 2, rate: 0.5 });
	});

	it('reports no rate when nothing has been decided anywhere', () => {
		expect(overallCompletion([])).toEqual({ closed: 0, decided: 0, rate: null });
	});
});

describe('a derived parent contributes its own closed-orbit history, same as a leaf', () => {
	const now = new Date('2026-09-16T12:00:00Z');
	const parent = goal({
		id: 'parent',
		tier: 'starSystem',
		target: 1,
		createdAt: new Date('2026-07-01T00:00:00Z')
	});
	const child: ChildInput = {
		goal: goal({ id: 'child', tier: 'planet', target: 2, parentId: 'parent' }),
		entries: [
			// One closed week in July closes the parent's July orbit.
			entry('2026-07-06T12:00:00Z', 2),
			// Two closed weeks in August, which the parent never sees — archived
			// all of August, so that month is dormant rather than a bonus.
			entry('2026-08-03T12:00:00Z', 2),
			entry('2026-08-10T12:00:00Z', 2)
			// Nothing yet in September, the in-flight month.
		]
	};

	const snapshot = snapshotDerivedGoal(parent, [child], {
		...utc,
		now,
		historyLength: 3,
		dormantWindows: [
			{ from: new Date('2026-08-01T00:00:00Z'), until: new Date('2026-09-01T00:00:00Z') }
		]
	});

	it('closes the parent orbit from child closures, and marks the archived month dormant', () => {
		expect(
			snapshot.history.map((orbit) => ({
				key: orbit.period.key,
				complete: orbit.complete,
				dormant: orbit.dormant
			}))
		).toEqual([
			{ key: 'month:2026-09', complete: false, dormant: false },
			// Two closed child weeks land in August, which would otherwise read
			// as complete too — dormant is what stops it counting as a win.
			{ key: 'month:2026-08', complete: true, dormant: true },
			{ key: 'month:2026-07', complete: true, dormant: false }
		]);
	});

	it('counts one decided, closed orbit — August never enters the denominator', () => {
		const tiers = completionByTier([{ tier: parent.tier, history: snapshot.history }], now);
		expect(tiers).toEqual([{ tier: 'starSystem', closed: 1, decided: 1, rate: 1 }]);
	});

	it('carries that single close into its best streak', () => {
		expect(bestStreak(snapshot.history)).toBe(1);
	});
});

describe('periodsSinceLaunch', () => {
	it('counts the launch day itself as the first period', () => {
		expect(
			periodsSinceLaunch(
				new Date('2026-09-10T00:00:00Z'),
				new Date('2026-09-12T18:00:00Z'),
				'day',
				utc
			)
		).toBe(3);
	});

	it('keeps counting Monday weeks straight through a daylight-saving change', () => {
		// 8 March 2026 falls inside the Denver week that opens 2 March, which
		// runs 167 hours instead of 168 — the same edge `period.test.ts` pins.
		const launched = new Date('2026-03-02T12:00:00Z');
		const now = new Date('2026-03-16T12:00:00Z');
		expect(periodsSinceLaunch(launched, now, 'week', { timeZone: 'America/Denver' })).toBe(3);
	});
});

describe('momentumFor', () => {
	const cadence = 'week';
	// Wednesday, 2.5 days into the Monday week of 14 September — the cutoff
	// every historical week is compared at is its own Wednesday noon.
	const now = new Date('2026-09-16T12:00:00Z');

	function input(overrides: Partial<MomentumInput> = {}): MomentumInput {
		return {
			goalId: 'goal-1',
			title: 'Read pages',
			tier: 'planet',
			cadence,
			createdAt: new Date('2025-01-01T00:00:00Z'),
			entries: [],
			dormantWindows: [],
			...overrides
		};
	}

	it('compares this week so far against the average at the same point in past weeks, skipping a dormant one', () => {
		const entries = [
			entry('2026-09-15T10:00:00Z', 5), // this week, before now — counts
			entry('2026-09-08T09:00:00Z', 2), // week -1, before its own cutoff
			entry('2026-09-10T10:00:00Z', 50), // week -1, after its cutoff — ignored
			entry('2026-08-31T08:00:00Z', 4), // week -2, before its cutoff
			entry('2026-08-24T08:00:00Z', 99), // week -3 — dormant, ignored entirely
			entry('2026-08-18T10:00:00Z', 6) // week -4, before its cutoff
		];

		const momentum = momentumFor(
			input({
				entries,
				dormantWindows: [
					{ from: new Date('2026-08-24T00:00:00Z'), until: new Date('2026-08-31T00:00:00Z') }
				]
			}),
			utc,
			now,
			3
		);

		// Baseline is weeks -1, -2 and -4 (2, 4, 6 → average 4), since the
		// dormant week -3 is skipped without counting toward the 3 samples.
		expect(momentum.ratio).toBeCloseTo(5 / 4);
	});

	it('has no baseline for a goal younger than one period', () => {
		const momentum = momentumFor(
			input({
				createdAt: new Date('2026-09-14T00:00:00Z'),
				entries: [entry('2026-09-15T10:00:00Z', 5)]
			}),
			utc,
			now
		);
		expect(momentum.ratio).toBeNull();
	});

	it('is neutral when this week and every past week at this point were both empty', () => {
		const momentum = momentumFor(input({ entries: [] }), utc, now, 2);
		expect(momentum.ratio).toBe(1);
	});

	it('cannot rate a first-ever push against a baseline that was always zero', () => {
		const momentum = momentumFor(
			input({ entries: [entry('2026-09-15T10:00:00Z', 5)] }),
			utc,
			now,
			2
		);
		expect(momentum.ratio).toBeNull();
	});
});

describe('averageMomentum and topMomentum', () => {
	function momentum(goalId: string, ratio: number | null) {
		return { goalId, title: goalId, tier: 'planet' as const, ratio };
	}

	it('averages only the goals with a baseline', () => {
		expect(averageMomentum([momentum('a', 1.5), momentum('b', null), momentum('c', 0.5)])).toBe(1);
	});

	it('is null when nobody has a baseline yet', () => {
		expect(averageMomentum([momentum('a', null)])).toBeNull();
	});

	it('ranks the biggest gains and drops, leaving out anything without a baseline', () => {
		const momenta = [
			momentum('gaining-most', 2),
			momentum('gaining-some', 1.2),
			momentum('flat', 1),
			momentum('slipping-some', 0.8),
			momentum('slipping-most', 0.3),
			momentum('unrated', null)
		];
		const { gaining, slipping } = topMomentum(momenta, 2);
		expect(gaining.map((m) => m.goalId)).toEqual(['gaining-most', 'gaining-some']);
		expect(slipping.map((m) => m.goalId)).toEqual(['slipping-most', 'slipping-some']);
	});
});

describe('loggingRhythm', () => {
	it('buckets entries by weekday and part of day in the user’s own zone', () => {
		const entries = [
			// 22:00 UTC on 14 Sep 2026 is 16:00 the same day in Denver — Monday
			// afternoon, not the small hours of Tuesday UTC would suggest.
			entry('2026-09-14T22:00:00Z'),
			entry('2026-09-14T23:30:00Z'), // 17:30 Denver, same Monday, afternoon
			entry('2026-09-15T13:00:00Z') // 07:00 Denver Tuesday, morning
		];

		const rhythm = loggingRhythm(entries, { timeZone: 'America/Denver' });

		expect(rhythm.byWeekday[1]).toBe(2); // Monday
		expect(rhythm.byWeekday[2]).toBe(1); // Tuesday
		expect(rhythm.peakWeekday).toBe('Monday');
		expect(rhythm.byPartOfDay.find((p) => p.part === 'Afternoon')?.count).toBe(2);
		expect(rhythm.byPartOfDay.find((p) => p.part === 'Morning')?.count).toBe(1);
		expect(rhythm.peakPart).toBe('Afternoon');
	});

	it('has no peak when nothing has been logged', () => {
		const rhythm = loggingRhythm([], utc);
		expect(rhythm.peakWeekday).toBeNull();
		expect(rhythm.peakPart).toBeNull();
		expect(rhythm.byWeekday).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});
});
