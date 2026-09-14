import { describe, expect, it } from 'vitest';
import {
	ORBIT_METRIC,
	PARENT_PROBLEM_MESSAGE,
	childrenOf,
	closedPeriods,
	eligibleParents,
	metricFor,
	parentPeriodFor,
	parentProblem,
	snapshotDerivedGoal,
	snapshotWithChildren,
	type ChildInput
} from './nesting';
import { periodFor } from './period';
import type { GoalSnapshot } from './progress';
import type { Goal } from './types';

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Move something',
		description: null,
		tier: 'planet',
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

function entry(iso: string, amount = 1) {
	return { amount, occurredAt: new Date(iso) };
}

function child(overrides: Partial<Goal>, entries: ChildInput['entries']): ChildInput {
	return { goal: goal(overrides), entries };
}

/** The orbit in `snapshot` for a period key, so a test can name the month it means. */
function orbitFor(snapshot: GoalSnapshot, key: string) {
	const orbit = snapshot.history.find((candidate) => candidate.period.key === key);
	if (!orbit)
		throw new Error(`no orbit for ${key} in ${snapshot.history.map((o) => o.period.key)}`);
	return orbit;
}

const utc = { timeZone: 'UTC' };
const denver = { timeZone: 'America/Denver' };

describe('a parent counts closed child orbits', () => {
	const parent = goal({ id: 'parent', tier: 'starSystem', target: 3 });
	const now = new Date('2026-09-20T12:00:00Z');

	it('counts one per closed child period', () => {
		const snapshot = snapshotDerivedGoal(
			parent,
			[
				child({ id: 'child', tier: 'planet', target: 2 }, [
					// Two closed weeks in September, one week short.
					entry('2026-09-01T12:00:00Z', 2),
					entry('2026-09-08T12:00:00Z', 2),
					entry('2026-09-15T12:00:00Z', 1)
				])
			],
			{ ...utc, now }
		);

		expect(snapshot.current.logged).toBe(2);
		expect(snapshot.current.target).toBe(3);
		expect(snapshot.current.complete).toBe(false);
		expect(snapshot.current.remaining).toBe(1);
	});

	it('contributes nothing for a child period that falls short', () => {
		const snapshot = snapshotDerivedGoal(
			parent,
			[
				// Two of three workouts in each of three weeks: zero toward the month,
				// however much that adds up to as an amount.
				child({ id: 'child', tier: 'planet', target: 3 }, [
					entry('2026-09-01T12:00:00Z', 2),
					entry('2026-09-08T12:00:00Z', 2),
					entry('2026-09-15T12:00:00Z', 2)
				])
			],
			{ ...utc, now }
		);

		expect(snapshot.current.logged).toBe(0);
	});

	it('contributes exactly one for a child period that overshoots', () => {
		const snapshot = snapshotDerivedGoal(
			parent,
			[
				// Nine workouts in one week against a target of three is one closed
				// orbit, not three. A parent cannot be crammed.
				child({ id: 'child', tier: 'planet', target: 3 }, [entry('2026-09-01T12:00:00Z', 9)])
			],
			{ ...utc, now }
		);

		expect(snapshot.current.logged).toBe(1);
	});

	it('counts direct children only', () => {
		// A Satellite feeds a Planet feeds a Star System. The Star System counts
		// the Planet's orbits — two closed weeks — and never the seven days under
		// them.
		const satellite: ChildInput = {
			goal: goal({ id: 'satellite', tier: 'satellite', target: 1, parentId: 'planet' }),
			entries: [
				entry('2026-09-01T12:00:00Z'),
				entry('2026-09-02T12:00:00Z'),
				entry('2026-09-03T12:00:00Z'),
				entry('2026-09-08T12:00:00Z'),
				entry('2026-09-09T12:00:00Z')
			]
		};
		const planet: ChildInput = {
			goal: goal({ id: 'planet', tier: 'planet', target: 2, parentId: 'parent' }),
			entries: [],
			children: [satellite]
		};

		const snapshot = snapshotDerivedGoal(parent, [planet], { ...utc, now });

		// Week of 31 Aug: three closed days, so the Planet's orbit closed. Week of
		// 7 Sep: two closed days, which also closes it. Two Planet orbits, not five
		// Satellite ones.
		expect(snapshot.current.logged).toBe(2);
	});

	it('ignores anything logged against the parent itself', () => {
		const snapshot = snapshotWithChildren(
			parent,
			[entry('2026-09-10T12:00:00Z', 99)],
			[child({ id: 'child', tier: 'planet', target: 1 }, [entry('2026-09-01T12:00:00Z')])],
			{ ...utc, now }
		);

		expect(snapshot.current.logged).toBe(1);
		expect(snapshot.lifetimeLogged).toBe(1);
	});

	it('falls back to the leaf snapshot when there are no children', () => {
		const leaf = goal({ id: 'leaf', tier: 'planet', target: 2 });
		const snapshot = snapshotWithChildren(leaf, [entry('2026-09-16T12:00:00Z', 2)], [], {
			...utc,
			now
		});

		expect(snapshot.derived).toBeUndefined();
		expect(snapshot.current.logged).toBe(2);
		expect(metricFor(snapshot)).toBe(leaf.metric);
	});

	it('is measured in orbits once it is derived', () => {
		const snapshot = snapshotDerivedGoal(parent, [child({ id: 'child', tier: 'planet' }, [])], {
			...utc,
			now
		});
		expect(metricFor(snapshot)).toBe(ORBIT_METRIC);
	});
});

describe('a closed child orbit lands in the parent period its own period ended in', () => {
	/*
	 * The case the spec calls the one most likely to be got wrong silently, at a
	 * boundary that is real in both directions: `America/Denver` around 1
	 * November 2026, a Sunday, which is also the day daylight saving ends.
	 */
	const parent = goal({ id: 'parent', tier: 'starSystem', target: 4 });
	const now = new Date('2026-11-15T18:00:00Z');

	it('counts a week that straddles the month boundary toward the month it finished in', () => {
		// Monday weeks: 26 October to 1 November. Six of its seven days are in
		// October and it finishes in November, so it is November's.
		const week = periodFor(new Date('2026-10-28T18:00:00Z'), 'week', denver);
		expect(week.key).toBe('week:2026-W44');
		// The fall-back Sunday inside it makes the week 169 hours long, not 168.
		expect(week.end.getTime() - week.start.getTime()).toBe(169 * 3_600_000);
		expect(parentPeriodFor(week, 'month', denver).key).toBe('month:2026-11');

		const snapshot = snapshotDerivedGoal(
			parent,
			[child({ id: 'child', tier: 'planet', target: 1 }, [entry('2026-10-28T18:00:00Z')])],
			{ ...denver, now }
		);

		expect(orbitFor(snapshot, 'month:2026-11').logged).toBe(1);
		expect(orbitFor(snapshot, 'month:2026-10').logged).toBe(0);
	});

	it('keeps a week that ends on the last day of a month in that month', () => {
		/*
		 * Sunday weeks: 25 to 31 October, whose exclusive end is midnight on 1
		 * November — the instant November starts. Reading `period.end` rather than
		 * the last instant it covers files this week under November and nothing
		 * anywhere fails; the parent's orbit is simply one out.
		 */
		const sundays = { ...denver, weekStartsOn: 0 };
		const week = periodFor(new Date('2026-10-27T18:00:00Z'), 'week', sundays);
		expect(periodFor(week.end, 'month', sundays).key).toBe('month:2026-11');
		expect(parentPeriodFor(week, 'month', sundays).key).toBe('month:2026-10');

		const snapshot = snapshotDerivedGoal(
			parent,
			[child({ id: 'child', tier: 'planet', target: 1 }, [entry('2026-10-27T18:00:00Z')])],
			{ ...sundays, now }
		);

		expect(orbitFor(snapshot, 'month:2026-10').logged).toBe(1);
		expect(orbitFor(snapshot, 'month:2026-11').logged).toBe(0);
	});

	it('lands a day daylight saving shortened in its own week', () => {
		// 8 March 2026 is 23 hours long in Denver. The day still ends inside the
		// week that opened on 2 March.
		const day = periodFor(new Date('2026-03-08T18:00:00Z'), 'day', denver);
		expect(day.end.getTime() - day.start.getTime()).toBe(23 * 3_600_000);
		expect(parentPeriodFor(day, 'week', denver).key).toBe('week:2026-W10');

		const snapshot = snapshotDerivedGoal(
			goal({ id: 'parent', tier: 'planet', target: 2 }),
			[child({ id: 'child', tier: 'satellite', target: 1 }, [entry('2026-03-08T18:00:00Z')])],
			{ ...denver, now: new Date('2026-03-12T18:00:00Z') }
		);

		expect(orbitFor(snapshot, 'week:2026-W10').logged).toBe(1);
		expect(orbitFor(snapshot, 'week:2026-W09').logged).toBe(0);
	});

	it('counts a day that ends a month toward that month, not the next', () => {
		// 1 March opens a Monday week, so the last day of February ends its own
		// month — the same boundary one cadence down.
		const day = periodFor(new Date('2026-02-28T18:00:00Z'), 'day', denver);
		expect(periodFor(day.end, 'month', denver).key).toBe('month:2026-03');
		expect(parentPeriodFor(day, 'month', denver).key).toBe('month:2026-02');
	});
});

describe('closed child periods', () => {
	const now = new Date('2026-09-20T12:00:00Z');

	it('skips a period the child spent archived', () => {
		const archived: ChildInput = {
			goal: goal({ id: 'child', tier: 'planet', target: 1 }),
			entries: [entry('2026-09-01T12:00:00Z'), entry('2026-09-15T12:00:00Z')],
			// Asleep for the whole week of 31 August, awake again by 14 September.
			dormantWindows: [{ from: new Date('2026-08-30T00:00:00Z'), until: null }]
		};

		expect(closedPeriods(archived, utc)).toHaveLength(0);
	});

	it('contributes nothing and breaks nothing when a child period is dormant', () => {
		const parent = goal({ id: 'parent', tier: 'starSystem', target: 1 });
		const asleep: ChildInput = {
			goal: goal({ id: 'child', tier: 'planet', target: 1 }),
			entries: [entry('2026-08-05T12:00:00Z'), entry('2026-09-16T12:00:00Z')],
			dormantWindows: [
				{ from: new Date('2026-08-31T00:00:00Z'), until: new Date('2026-09-14T00:00:00Z') }
			]
		};

		const snapshot = snapshotDerivedGoal(parent, [asleep], { ...utc, now });

		expect(orbitFor(snapshot, 'month:2026-08').complete).toBe(true);
		expect(orbitFor(snapshot, 'month:2026-09').complete).toBe(true);
		// Nothing closed in the fortnight the child was parked, and the parent's
		// own August and September orbits still carry the streak.
		expect(snapshot.streak).toBe(2);
	});

	it('never closes a child with no target', () => {
		expect(
			closedPeriods(child({ id: 'child', target: 0 }, [entry('2026-09-16T12:00:00Z', 5)]), utc)
		).toHaveLength(0);
	});
});

describe('a derived orbit closes at its target number of child orbits', () => {
	const now = new Date('2026-09-20T12:00:00Z');
	const parent = goal({ id: 'parent', tier: 'starSystem', target: 3 });

	it('closes exactly on the target and keeps a streak across months', () => {
		const weekly = child({ id: 'child', tier: 'planet', target: 1 }, [
			// Three closed weeks in August, three in September.
			entry('2026-08-04T12:00:00Z'),
			entry('2026-08-11T12:00:00Z'),
			entry('2026-08-18T12:00:00Z'),
			entry('2026-09-01T12:00:00Z'),
			entry('2026-09-08T12:00:00Z'),
			entry('2026-09-15T12:00:00Z')
		]);

		const snapshot = snapshotDerivedGoal(parent, [weekly], { ...utc, now });

		expect(snapshot.current.complete).toBe(true);
		expect(snapshot.streak).toBe(2);
		expect(snapshot.totalOrbits).toBe(2);
		expect(snapshot.lifetimeLogged).toBe(6);
	});

	it('adds up its direct children rather than picking one', () => {
		const snapshot = snapshotDerivedGoal(
			parent,
			[
				child({ id: 'a', tier: 'planet', target: 1 }, [entry('2026-09-01T12:00:00Z')]),
				child({ id: 'b', tier: 'satellite', target: 1 }, [
					entry('2026-09-02T12:00:00Z'),
					entry('2026-09-03T12:00:00Z')
				])
			],
			{ ...utc, now }
		);

		expect(snapshot.current.logged).toBe(3);
		expect(snapshot.current.complete).toBe(true);
		expect(snapshot.derived?.children.map((each) => each.closed)).toEqual([1, 2]);
	});

	it('describes each child so the dial can fly it', () => {
		const snapshot = snapshotDerivedGoal(
			parent,
			[
				child({ id: 'a', tier: 'planet', target: 4, color: '#7dd3fc' }, [
					entry(now.toISOString(), 2)
				])
			],
			{ ...utc, now }
		);

		const [standing] = snapshot.derived?.children ?? [];
		expect(standing.goalId).toBe('a');
		expect(standing.tier).toBe('planet');
		expect(standing.color).toBe('#7dd3fc');
		// Half way round its own ring, and nothing fed up yet.
		expect(standing.current.fraction).toBeCloseTo(0.5);
		expect(standing.closed).toBe(0);
	});
});

describe('parentProblem', () => {
	const goals = [
		{ id: 'day', title: 'Read', tier: 'satellite', parentId: null, archivedAt: null },
		{ id: 'week', title: 'Run', tier: 'planet', parentId: null, archivedAt: null },
		{ id: 'month', title: 'Ship', tier: 'starSystem', parentId: 'week', archivedAt: null },
		{ id: 'parked', title: 'Rest', tier: 'galaxy', parentId: null, archivedAt: new Date() }
	] as const;

	it('accepts a strictly longer cadence', () => {
		expect(parentProblem({ id: 'day', tier: 'satellite' }, 'week', goals)).toBeNull();
	});

	it('rejects a goal that is not the user’s', () => {
		expect(parentProblem({ id: 'day', tier: 'satellite' }, 'somebody-else', goals)).toBe('unknown');
	});

	it('rejects a goal orbiting itself', () => {
		expect(parentProblem({ id: 'week', tier: 'planet' }, 'week', goals)).toBe('self');
	});

	it('rejects an equal cadence', () => {
		expect(
			parentProblem({ id: 'other-week', tier: 'planet' }, 'week', [
				...goals,
				{ id: 'other-week', title: 'Swim', tier: 'planet', parentId: null, archivedAt: null }
			])
		).toBe('cadence');
	});

	it('rejects a shorter cadence', () => {
		expect(parentProblem({ id: 'week', tier: 'planet' }, 'day', goals)).toBe('cadence');
	});

	it('rejects a cycle rather than leaving it to be found at read time', () => {
		// `month` already feeds `week`, so `week` feeding `month` closes the loop.
		expect(parentProblem({ id: 'week', tier: 'planet' }, 'month', goals)).toBe('cycle');
	});

	it('allows no parent at all', () => {
		expect(parentProblem({ id: 'week', tier: 'planet' }, null, goals)).toBeNull();
		expect(parentProblem({ tier: 'planet' }, '', goals)).toBeNull();
	});

	it('has a message for every rejection', () => {
		for (const problem of ['unknown', 'self', 'cadence', 'cycle'] as const) {
			expect(PARENT_PROBLEM_MESSAGE[problem]).toMatch(/\S/);
		}
	});

	it('offers nothing that would be rejected', () => {
		// `month` already feeds `week`, so offering it back would close a loop, and
		// `parked` is archived. Nothing else is longer than a week.
		expect(eligibleParents({ id: 'week', tier: 'planet' }, goals)).toEqual([]);
	});

	it('offers the longer cadences and leaves archived goals out', () => {
		expect(eligibleParents({ id: 'day', tier: 'satellite' }, goals).map((each) => each.id)).toEqual(
			['week', 'month']
		);
	});
});

describe('childrenOf', () => {
	it('picks the direct children out of a loaded set', () => {
		const all = [
			goal({ id: 'a', parentId: 'parent' }),
			goal({ id: 'b', parentId: null }),
			goal({ id: 'c', parentId: 'a' })
		];
		expect(childrenOf('parent', all).map((each) => each.id)).toEqual(['a']);
	});
});
