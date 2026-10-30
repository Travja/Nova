import { describe, expect, it } from 'vitest';
import {
	endInstant,
	endUnder,
	goalStatus,
	isFinalPeriod,
	isFinished,
	lastInstant,
	localDateOf,
	outlives,
	parseLocalDate,
	presetLastDay,
	recordInstant,
	resolveEnd
} from './ending';
import { periodFor } from './period';
import { snapshotGoal } from './progress';
import { eligibleParents, parentProblem, snapshotDerivedGoal } from './nesting';
import { universeTree } from './universe';
import type { Goal } from './types';

const denver = { timeZone: 'America/Denver' };
const tokyo = { timeZone: 'Asia/Tokyo' };
const utc = { timeZone: 'UTC' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Sober October',
		description: null,
		tier: 'satellite',
		metric: { kind: 'checkin', unit: '' },
		target: 1,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2026-10-01T12:00:00Z'),
		archivedAt: null,
		endsAt: null,
		parentId: null,
		...overrides
	};
}

function entry(iso: string, amount = 1) {
	return { amount, occurredAt: new Date(iso) };
}

describe('the end instant', () => {
	it('is the end of the last day in the pilot’s own zone, not UTC', () => {
		// The last day is 31 October; in Denver that day ends at local midnight,
		// which is 06:00 UTC on 1 November — still on daylight time, UTC-6.
		const endsAt = endInstant({ year: 2026, month: 10, day: 31 }, 'satellite', denver);
		expect(endsAt.toISOString()).toBe('2026-11-01T06:00:00.000Z');
	});

	it('lands on a 25-hour day across the fall-back transition', () => {
		// US DST ends on 1 November 2026, so that day is 25 hours long and ends
		// at 07:00 UTC rather than 06:00.
		const endsAt = endInstant({ year: 2026, month: 11, day: 1 }, 'satellite', denver);
		expect(endsAt.toISOString()).toBe('2026-11-02T07:00:00.000Z');
		const last = periodFor(lastInstant(endsAt), 'day', denver);
		expect((last.end.getTime() - last.start.getTime()) / 3_600_000).toBe(25);
	});

	it('lands on a 23-hour day across the spring-forward transition', () => {
		// 8 March 2026: Denver skips 02:00 to 03:00.
		const endsAt = endInstant({ year: 2026, month: 3, day: 8 }, 'satellite', denver);
		expect(endsAt.toISOString()).toBe('2026-03-09T06:00:00.000Z');
		const last = periodFor(lastInstant(endsAt), 'day', denver);
		expect((last.end.getTime() - last.start.getTime()) / 3_600_000).toBe(23);
	});

	it('flies the whole period that holds the last day', () => {
		// A Wednesday last day for a weekly goal is the end of that Monday week.
		const endsAt = endInstant({ year: 2026, month: 10, day: 28 }, 'planet', denver);
		expect(endsAt.toISOString()).toBe('2026-11-02T07:00:00.000Z');
		// …and that week holds the fall-back Sunday, so it is 169 hours long.
		const last = periodFor(lastInstant(endsAt), 'week', denver);
		expect((last.end.getTime() - last.start.getTime()) / 3_600_000).toBe(169);
	});

	it('stays put when the pilot moves zone', () => {
		const endsAt = endInstant({ year: 2026, month: 10, day: 31 }, 'satellite', denver);
		const challenge = goal({ endsAt });

		// The instant is the instant: still flying a millisecond before it, finished
		// at it, in whichever zone the pilot now keeps.
		expect(isFinished(challenge, lastInstant(endsAt))).toBe(false);
		expect(isFinished(challenge, endsAt)).toBe(true);

		// Read in Tokyo, 06:00 UTC is 15:00 on 1 November, so the last orbit is
		// the Tokyo day that holds the instant before it — 1 November there.
		const inTokyo = snapshotGoal(challenge, [], {
			...tokyo,
			now: new Date('2026-12-01T00:00:00Z')
		});
		expect(inTokyo.current.period.key).toBe('day:2026-11-01');
		expect(localDateOf(lastInstant(endsAt), tokyo.timeZone)).toEqual({
			year: 2026,
			month: 11,
			day: 1
		});
	});
});

describe('presets', () => {
	// 21:00 on 1 October in Denver, which is already 2 October in UTC.
	const now = new Date('2026-10-02T03:00:00Z');

	it('counts today as the first of 30 days', () => {
		expect(presetLastDay('30d', now, denver)).toEqual({ year: 2026, month: 10, day: 30 });
	});

	it('counts today as the first of 12 weeks', () => {
		expect(presetLastDay('12w', now, denver)).toEqual({ year: 2026, month: 12, day: 23 });
	});

	it('takes the last day of the quarter in flight', () => {
		expect(presetLastDay('quarter', now, denver)).toEqual({ year: 2026, month: 12, day: 31 });
	});

	it('reads today in the pilot’s zone rather than UTC', () => {
		expect(presetLastDay('30d', now, utc)).toEqual({ year: 2026, month: 10, day: 31 });
	});
});

describe('resolveEnd', () => {
	const now = new Date('2026-10-14T18:00:00Z');
	const context = { tier: 'planet' as const, now, options: denver, current: null };

	it('reads never as no end', () => {
		expect(resolveEnd('', undefined, context)).toEqual({ ok: true, endsAt: null });
	});

	it('keeps a stored end exactly, whatever the zone says now', () => {
		const current = new Date('2026-10-05T06:00:00Z');
		expect(resolveEnd('keep', undefined, { ...context, options: tokyo, current })).toEqual({
			ok: true,
			endsAt: current
		});
	});

	it('turns a date into the end of the period holding it', () => {
		const resolved = resolveEnd('date', '2026-10-28', context);
		expect(resolved).toEqual({ ok: true, endsAt: new Date('2026-11-02T07:00:00Z') });
	});

	it('allows the period in flight as the last one', () => {
		// The 14th is a Wednesday; the 12th is that week's Monday.
		expect(resolveEnd('date', '2026-10-12', context).ok).toBe(true);
	});

	it('refuses a last period that is already behind', () => {
		expect(resolveEnd('date', '2026-10-11', context)).toEqual({ ok: false, problem: 'past' });
	});

	it('refuses a date that is not one', () => {
		expect(resolveEnd('date', '2026-02-30', context)).toEqual({ ok: false, problem: 'date' });
		expect(resolveEnd('date', '', context)).toEqual({ ok: false, problem: 'date' });
	});
});

describe('parseLocalDate', () => {
	it('reads a date field', () => {
		expect(parseLocalDate('2026-03-08')).toEqual({ year: 2026, month: 3, day: 8 });
	});

	it('refuses anything else', () => {
		expect(parseLocalDate('2026-3-8')).toBeNull();
		expect(parseLocalDate(undefined)).toBeNull();
	});
});

describe('finished is its own state', () => {
	const endsAt = new Date('2026-11-01T06:00:00Z');
	const after = new Date('2026-11-05T00:00:00Z');

	it('reads flying, archived and finished', () => {
		expect(goalStatus(goal(), after)).toBe('flying');
		expect(goalStatus(goal({ archivedAt: after }), after)).toBe('archived');
		expect(goalStatus(goal({ endsAt }), after)).toBe('finished');
	});

	it('finishes at once when the end passes while archived', () => {
		const parked = goal({ endsAt, archivedAt: new Date('2026-10-20T00:00:00Z') });
		expect(goalStatus(parked, new Date('2026-10-25T00:00:00Z'))).toBe('archived');
		expect(goalStatus(parked, after)).toBe('finished');
	});

	it('draws a finished goal from its last instant and an archived one from its archiving', () => {
		const archivedAt = new Date('2026-10-20T00:00:00Z');
		expect(recordInstant(goal({ endsAt }), after)).toEqual(lastInstant(endsAt));
		expect(recordInstant(goal({ archivedAt }), after)).toEqual(archivedAt);
		expect(recordInstant(goal({ endsAt, archivedAt }), after)).toEqual(lastInstant(endsAt));
		expect(recordInstant(goal(), after)).toEqual(after);
	});
});

describe('a finished goal’s record', () => {
	const endsAt = new Date('2026-10-04T06:00:00Z'); // after 3 October in Denver
	const challenge = goal({ endsAt, createdAt: new Date('2026-10-01T12:00:00Z') });
	const later = new Date('2026-12-25T12:00:00Z');

	it('stops at its last period however long ago that was', () => {
		const snapshot = snapshotGoal(challenge, [], { ...denver, now: later, historyLength: 3 });
		expect(snapshot.history.map((orbit) => orbit.period.key)).toEqual([
			'day:2026-10-03',
			'day:2026-10-02',
			'day:2026-10-01'
		]);
	});

	it('never goes dormant', () => {
		const snapshot = snapshotGoal(challenge, [], { ...denver, now: later, historyLength: 3 });
		expect(snapshot.history.every((orbit) => !orbit.dormant)).toBe(true);
	});

	it('ends on the streak its final orbit leaves, with no benefit of the doubt', () => {
		const flown = [entry('2026-10-01T18:00:00Z'), entry('2026-10-02T18:00:00Z')];
		const missedLast = snapshotGoal(challenge, flown, { ...denver, now: later, historyLength: 3 });
		// Flying, a missed in-flight orbit would be excused and the streak read 2.
		expect(missedLast.streak).toBe(0);

		const closedLast = snapshotGoal(challenge, [...flown, entry('2026-10-03T18:00:00Z')], {
			...denver,
			now: later,
			historyLength: 3
		});
		expect(closedLast.streak).toBe(3);
		expect(closedLast.totalOrbits).toBe(3);
	});

	it('counts nothing a file stretched past the end', () => {
		const snapshot = snapshotGoal(challenge, [entry('2026-10-10T18:00:00Z')], {
			...denver,
			now: later
		});
		expect(snapshot.totalOrbits).toBe(0);
		expect(snapshot.lifetimeLogged).toBe(0);
	});

	it('marks the last period as the final one', () => {
		const last = periodFor(lastInstant(endsAt), 'day', denver);
		const before = periodFor(new Date('2026-10-02T18:00:00Z'), 'day', denver);
		expect(isFinalPeriod(challenge, last)).toBe(true);
		expect(isFinalPeriod(challenge, before)).toBe(false);
		expect(isFinalPeriod(goal(), last)).toBe(false);
	});
});

describe('extending a finished goal', () => {
	it('counts the time it spent landed as missed, not dormant', () => {
		const flown = [entry('2026-10-01T18:00:00Z'), entry('2026-10-02T18:00:00Z')];
		const extended = goal({ endsAt: new Date('2026-11-01T06:00:00Z') });
		const now = new Date('2026-10-10T18:00:00Z');
		const snapshot = snapshotGoal(extended, flown, { ...denver, now, historyLength: 10 });

		// 3 to 9 October are the days it was landed under its old end: ordinary,
		// empty, and so a break in the streak.
		const gap = snapshot.history.slice(1, 8);
		expect(gap.every((orbit) => !orbit.dormant && !orbit.complete)).toBe(true);
		expect(snapshot.streak).toBe(0);
	});
});

describe('nesting never sees a finished parent', () => {
	const options = denver;
	const now = new Date('2026-11-10T18:00:00Z');
	const parentEnd = new Date('2026-11-01T06:00:00Z'); // end of October in Denver
	const parent = goal({ id: 'parent', tier: 'starSystem', endsAt: parentEnd, target: 2 });

	it('stops a finished child feeding from the period after its end', () => {
		const childEnd = new Date('2026-10-12T06:00:00Z'); // after the week of 5 October
		const week = goal({ id: 'week', tier: 'planet', parentId: 'parent', endsAt: childEnd });
		const open = goal({ id: 'month', tier: 'starSystem', target: 1 });
		const entries = [entry('2026-10-06T18:00:00Z'), entry('2026-10-20T18:00:00Z')];

		const snapshot = snapshotDerivedGoal(open, [{ goal: week, entries }], {
			...options,
			now,
			historyLength: 2
		});
		// October keeps the week it closed before the child ended; nothing after.
		expect(snapshot.lifetimeLogged).toBe(1);
	});

	it('keeps a finished parent’s past counts and reads them back from its end', () => {
		const week = goal({ id: 'week', tier: 'planet', parentId: 'parent', endsAt: parentEnd });
		const snapshot = snapshotDerivedGoal(
			parent,
			[{ goal: week, entries: [entry('2026-10-06T18:00:00Z'), entry('2026-10-13T18:00:00Z')] }],
			{ ...options, now }
		);
		expect(snapshot.current.period.key).toBe('month:2026-10');
		expect(snapshot.current.complete).toBe(true);
		expect(snapshot.streak).toBe(1);
	});

	it('never offers a finished goal as a parent, except the one a goal already has', () => {
		const goals = [
			{
				id: 'parent',
				title: 'October',
				tier: 'starSystem' as const,
				parentId: null,
				endsAt: parentEnd
			},
			{ id: 'open', title: 'Always', tier: 'starSystem' as const, parentId: null, endsAt: null }
		];
		expect(eligibleParents({ tier: 'planet' }, goals, now).map((g) => g.id)).toEqual(['open']);
		expect(
			eligibleParents({ id: 'week', tier: 'planet', parentId: 'parent' }, goals, now).map(
				(g) => g.id
			)
		).toEqual(['parent', 'open']);
	});

	it('refuses a child that would outlive the parent it feeds', () => {
		const goals = [
			{
				id: 'parent',
				title: 'October',
				tier: 'starSystem' as const,
				parentId: null,
				endsAt: parentEnd
			}
		];
		expect(parentProblem({ tier: 'planet', endsAt: null }, 'parent', goals, options)).toBe('ends');
		expect(
			parentProblem(
				{ tier: 'planet', endsAt: new Date('2026-12-01T07:00:00Z') },
				'parent',
				goals,
				options
			)
		).toBe('ends');
		// Ending with it is fine, straddling week and all.
		const withIt = endUnder(parentEnd, 'planet', options);
		expect(parentProblem({ tier: 'planet', endsAt: withIt }, 'parent', goals, options)).toBeNull();
		// The shape-only check the picker runs knows nothing about ends.
		expect(parentProblem({ tier: 'planet', endsAt: null }, 'parent', goals)).toBeNull();
	});

	it('ends a child with its parent on the end of its own straddling period', () => {
		// October 2026 ends on a Saturday, so the week holding its last instant
		// runs to Monday 2 November — past the parent, and still not outliving it.
		const withIt = endUnder(parentEnd, 'planet', options);
		expect(withIt.toISOString()).toBe('2026-11-02T07:00:00.000Z');
		expect(outlives({ tier: 'planet', endsAt: withIt }, parent, options)).toBe(false);
		expect(outlives({ tier: 'planet', endsAt: null }, parent, options)).toBe(true);
		expect(outlives({ tier: 'planet', endsAt: null }, { endsAt: null }, options)).toBe(false);
	});

	it('lets the universe hang nothing off a finished goal', () => {
		const week = goal({ id: 'week', tier: 'planet', parentId: 'parent' });
		const snapshots = [
			snapshotGoal(parent, [], { ...options, now }),
			snapshotGoal(week, [], { ...options, now })
		];
		const tree = universeTree(snapshots, [], now);

		const ids: string[] = [];
		const walk = (node: typeof tree.root) => {
			if (node.goalId) ids.push(node.goalId);
			node.children.forEach(walk);
		};
		walk(tree.root);
		expect(ids).toEqual(['week']);
		// The week orbits its tier's anchor, a star, rather than a landed parent.
		expect(tree.home?.children.some((node) => node.goalId === 'week')).toBe(true);
	});
});
