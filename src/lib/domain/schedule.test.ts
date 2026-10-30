import { describe, expect, it } from 'vitest';
import { periodFor } from './period';
import {
	buildOrbit,
	focusForToday,
	orbitStanding,
	relogOrbit,
	snapshotGoal,
	streakFrom,
	type Orbit
} from './progress';
import {
	describeRestDays,
	EVERY_DAY,
	flyingDayCount,
	latestSchedule,
	maskFromFlyingDays,
	restDayUnder,
	restsOn,
	scheduleAt,
	scheduleChange,
	weekdaysInOrder,
	type RestSchedule
} from './schedule';
import { restDayCapacity, restDayWarning, snapshotDerivedGoal } from './nesting';
import { overlayAll, overlayQueued } from './queue';
import { reminderFor } from './reminders';
import { completionByTier, momentumFor } from './stats';
import { goalSchema, REST_EVERY_DAY_MESSAGE } from './validation';
import type { Goal } from './types';

const SUN = 0;
const MON = 1;
const SAT = 6;
/** Rests Saturday and Sunday: a weekday-only satellite. */
const WEEKENDS = (1 << SAT) | (1 << SUN);

const denver = { timeZone: 'America/Denver' };
const utc = { timeZone: 'UTC' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'gym',
		userId: 'user-1',
		title: 'Gym',
		description: null,
		tier: 'satellite',
		metric: { kind: 'checkin', unit: '' },
		target: 1,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		archivedAt: null,
		parentId: null,
		endsAt: null,
		...overrides
	};
}

function checkIn(iso: string) {
	return { amount: 1, occurredAt: new Date(iso) };
}

/** Every day since launch flies weekends off, from one span at launch. */
const weekdaysOnly: RestSchedule[] = [
	{ from: new Date('2026-01-01T00:00:00Z'), restDays: WEEKENDS }
];

describe('the mask', () => {
	it('numbers weekdays the way zonedDayOfWeek does, Sunday as 0', () => {
		expect(restsOn(WEEKENDS, SUN)).toBe(true);
		expect(restsOn(WEEKENDS, SAT)).toBe(true);
		expect(restsOn(WEEKENDS, MON)).toBe(false);
	});

	it('is built from the days that fly, which is what the form posts', () => {
		expect(maskFromFlyingDays([1, 2, 3, 4, 5])).toBe(WEEKENDS);
		expect(maskFromFlyingDays([0, 1, 2, 3, 4, 5, 6])).toBe(0);
		expect(maskFromFlyingDays([])).toBe(EVERY_DAY);
		expect(flyingDayCount(WEEKENDS)).toBe(5);
	});

	it('reads in the week order the user chose', () => {
		expect(weekdaysInOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
		expect(weekdaysInOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(describeRestDays(WEEKENDS, 1)).toBe('Sat, Sun');
		expect(describeRestDays(WEEKENDS, 0)).toBe('Sun, Sat');
		expect(describeRestDays(0)).toBeNull();
	});
});

describe('restDayUnder', () => {
	it('rests a Saturday and flies a Monday', () => {
		const saturday = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);
		const monday = periodFor(new Date('2026-09-14T12:00:00Z'), 'day', utc);
		expect(restDayUnder(saturday, weekdaysOnly, 'UTC')).toBe(true);
		expect(restDayUnder(monday, weekdaysOnly, 'UTC')).toBe(false);
	});

	it('flies every day with no schedule at all', () => {
		const saturday = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);
		expect(restDayUnder(saturday, [], 'UTC')).toBe(false);
	});

	it('only ever rests a day — a week is never a rest week', () => {
		const week = periodFor(new Date('2026-09-12T12:00:00Z'), 'week', utc);
		expect(restDayUnder(week, [{ from: new Date(0), restDays: 0b111_1110 }], 'UTC')).toBe(false);
	});

	it('ignores a span that starts after the day does', () => {
		const saturday = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);
		const later = [{ from: new Date('2026-09-13T00:00:00Z'), restDays: WEEKENDS }];
		expect(restDayUnder(saturday, later, 'UTC')).toBe(false);
	});

	/**
	 * The rule `CLAUDE.md` asks a test for. 8 March 2026 is the Sunday Denver
	 * springs forward, a 23-hour day; the weekday comes from the zone at the
	 * period's start, so it is still one Sunday, the Saturday before is still a
	 * Saturday, and the Monday after still flies.
	 */
	it('reads the weekday in Denver across the spring-forward Sunday', () => {
		const saturday = periodFor(new Date('2026-03-07T19:00:00Z'), 'day', denver);
		const sunday = periodFor(new Date('2026-03-08T19:00:00Z'), 'day', denver);
		const monday = periodFor(new Date('2026-03-09T19:00:00Z'), 'day', denver);

		expect(sunday.end.getTime() - sunday.start.getTime()).toBe(23 * 60 * 60 * 1000);
		expect(restDayUnder(saturday, weekdaysOnly, denver.timeZone)).toBe(true);
		expect(restDayUnder(sunday, weekdaysOnly, denver.timeZone)).toBe(true);
		expect(restDayUnder(monday, weekdaysOnly, denver.timeZone)).toBe(false);
	});

	it('files a late Sunday check-in in Denver under the rest day, not UTC Monday', () => {
		// 23:30 on Sunday 8 March in Denver is 05:30 on Monday in UTC.
		const late = new Date('2026-03-09T05:30:00Z');
		const day = periodFor(late, 'day', denver);
		expect(restDayUnder(day, weekdaysOnly, denver.timeZone)).toBe(true);
	});

	it('reads the weekday across the fall-back Sunday in Denver too', () => {
		const sunday = periodFor(new Date('2026-11-01T19:00:00Z'), 'day', denver);
		const monday = periodFor(new Date('2026-11-02T19:00:00Z'), 'day', denver);
		expect(sunday.end.getTime() - sunday.start.getTime()).toBe(25 * 60 * 60 * 1000);
		expect(restDayUnder(sunday, weekdaysOnly, denver.timeZone)).toBe(true);
		expect(restDayUnder(monday, weekdaysOnly, denver.timeZone)).toBe(false);
	});

	it('uses the local weekday where local midnight is the previous UTC day', () => {
		// Midnight Monday in Auckland is Sunday morning in UTC, so a UTC weekday
		// would rest a Monday here.
		const monday = periodFor(new Date('2026-09-14T03:00:00Z'), 'day', {
			timeZone: 'Pacific/Auckland'
		});
		expect(monday.start.getUTCDay()).toBe(SUN);
		expect(restDayUnder(monday, weekdaysOnly, 'Pacific/Auckland')).toBe(false);
	});
});

describe('rest days are dormant until they close', () => {
	const saturday = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);

	it('marks an unclosed rest day dormant', () => {
		const orbit = buildOrbit(saturday, 0, 1, false, true);
		expect(orbit).toMatchObject({ dormant: true, rest: true, complete: false });
	});

	it('counts a rest day that closed as an ordinary closed orbit', () => {
		const orbit = buildOrbit(saturday, 1, 1, false, true);
		expect(orbit).toMatchObject({ dormant: false, rest: true, complete: true });
	});

	it('lets archiving win over resting', () => {
		const orbit = buildOrbit(saturday, 1, 1, true, true);
		expect(orbit).toMatchObject({ dormant: true, rest: false });
	});

	it('wakes and sleeps again as an amount moves through relogOrbit', () => {
		const resting = buildOrbit(saturday, 0, 1, false, true);
		const flown = relogOrbit(resting, 1);
		expect(flown.dormant).toBe(false);
		expect(relogOrbit(flown, 0).dormant).toBe(true);

		const archived = buildOrbit(saturday, 0, 1, true);
		expect(relogOrbit(archived, 1).dormant).toBe(true);
	});
});

describe('orbitStanding tells a rest day from an archived period', () => {
	const saturday = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);

	it('says rest day for an unclosed rest day', () => {
		expect(orbitStanding(buildOrbit(saturday, 0, 1, false, true))).toBe(
			'rest day, no orbit expected'
		);
	});

	it('says archived for an archived one', () => {
		expect(orbitStanding(buildOrbit(saturday, 0, 1, true))).toBe(
			'archived for this period, no orbit expected'
		);
	});

	it('says a rest day flown anyway closed', () => {
		expect(orbitStanding(buildOrbit(saturday, 1, 1, false, true))).toBe(
			'orbit closed on a rest day, 100% of target logged'
		);
	});
});

describe('a weekday-only satellite', () => {
	// Monday 14 September 2026, evening.
	const monday = new Date('2026-09-14T18:00:00Z');
	const weekdays = [
		'2026-09-07T09:00:00Z',
		'2026-09-08T09:00:00Z',
		'2026-09-09T09:00:00Z',
		'2026-09-10T09:00:00Z',
		'2026-09-11T09:00:00Z'
	].map(checkIn);

	it('keeps its streak across a weekend it rested', () => {
		const snapshot = snapshotGoal(goal(), weekdays, {
			...utc,
			now: monday,
			restSchedules: weekdaysOnly
		});
		expect(snapshot.history[1].dormant).toBe(true); // Sunday
		expect(snapshot.history[2].dormant).toBe(true); // Saturday
		expect(snapshot.streak).toBe(5);
	});

	it('breaks it without the schedule, which is the bug this fixes', () => {
		const snapshot = snapshotGoal(goal(), weekdays, { ...utc, now: monday });
		expect(snapshot.streak).toBe(0);
	});

	it('extends the streak with a rest day it flew anyway', () => {
		const snapshot = snapshotGoal(goal(), [...weekdays, checkIn('2026-09-12T10:00:00Z')], {
			...utc,
			now: monday,
			restSchedules: weekdaysOnly
		});
		expect(snapshot.history[2]).toMatchObject({ rest: true, complete: true, dormant: false });
		expect(snapshot.streak).toBe(6);
		expect(snapshot.totalOrbits).toBe(6);
	});

	it('handles a closed orbit sitting between dormant ones', () => {
		const sat = periodFor(new Date('2026-09-12T12:00:00Z'), 'day', utc);
		const history: Orbit[] = [
			buildOrbit(periodFor(monday, 'day', utc), 0, 1),
			buildOrbit(periodFor(new Date('2026-09-13T12:00:00Z'), 'day', utc), 0, 1, false, true),
			buildOrbit(sat, 1, 1, false, true),
			buildOrbit(periodFor(new Date('2026-09-11T12:00:00Z'), 'day', utc), 0, 1, true),
			buildOrbit(periodFor(new Date('2026-09-10T12:00:00Z'), 'day', utc), 1, 1)
		];
		expect(streakFrom(history)).toBe(2);
	});

	it('is not owed on Today on a Saturday, and sends no reminder', () => {
		const saturdayEvening = new Date('2026-09-12T20:00:00Z');
		const snapshot = snapshotGoal(goal(), weekdays, {
			...utc,
			now: saturdayEvening,
			restSchedules: weekdaysOnly
		});
		const focus = focusForToday([snapshot], saturdayEvening);
		expect(focus.atRisk).toHaveLength(0);
		expect(focus.steady.map((row) => row.owedToday)).toEqual([false]);
		expect(reminderFor([snapshot], saturdayEvening)).toBeNull();
	});

	it('is owed on Today on a Monday', () => {
		const snapshot = snapshotGoal(goal(), weekdays, {
			...utc,
			now: monday,
			restSchedules: weekdaysOnly
		});
		expect(focusForToday([snapshot], monday).atRisk.map((row) => row.owedToday)).toEqual([true]);
	});

	it('leaves rest days out of completion rates unless they closed', () => {
		const flownSaturday = [...weekdays, checkIn('2026-09-12T10:00:00Z')];
		const snapshot = snapshotGoal(goal(), flownSaturday, {
			...utc,
			now: monday,
			historyLength: 8,
			restSchedules: weekdaysOnly
		});
		// Mon 7 – Sun 13: five weekdays and the Saturday closed, Sunday rested.
		expect(completionByTier([{ tier: 'satellite', history: snapshot.history }], monday)).toEqual([
			{ tier: 'satellite', closed: 6, decided: 6, rate: 1 }
		]);
	});

	it('leaves rest days out of the momentum baseline', () => {
		const input = {
			goalId: 'gym',
			title: 'Gym',
			tier: 'satellite' as const,
			cadence: 'day' as const,
			createdAt: new Date('2026-09-07T00:00:00Z'),
			entries: weekdays,
			dormantWindows: []
		};
		const at = new Date('2026-09-14T12:00:00Z');
		// Seven days back, two of them empty weekends. The rest-aware baseline
		// averages only the five days meant to fly, so a Monday like every other
		// weekday reads as exactly on pace rather than ahead of it.
		const withToday = [...weekdays, checkIn('2026-09-14T09:00:00Z')];
		expect(
			momentumFor({ ...input, entries: withToday, restSchedules: weekdaysOnly }, utc, at).ratio
		).toBeCloseTo(1);
		expect(momentumFor({ ...input, entries: withToday }, utc, at).ratio).toBeCloseTo(7 / 5);
	});
});

describe('changing the schedule never changes the past', () => {
	it('starts a change tomorrow, not today', () => {
		const saturdayMorning = new Date('2026-09-12T09:00:00Z');
		const change = scheduleChange([], WEEKENDS, saturdayMorning, utc);
		expect(change.from).toEqual(new Date('2026-09-13T00:00:00Z'));
		expect(change.insert).toEqual({ from: change.from, restDays: WEEKENDS });
	});

	it('starts a launch today, which has no past to protect', () => {
		const change = scheduleChange([], WEEKENDS, new Date('2026-09-12T09:00:00Z'), {
			...utc,
			launching: true
		});
		expect(change.from).toEqual(new Date('2026-09-12T00:00:00Z'));
	});

	it('starts tomorrow in the user zone, across a DST night in Denver', () => {
		// Saturday 7 March 2026, evening in Denver; tomorrow is the 23-hour Sunday.
		const change = scheduleChange([], WEEKENDS, new Date('2026-03-08T03:00:00Z'), denver);
		expect(change.from).toEqual(new Date('2026-03-08T07:00:00Z'));
	});

	it('writes nothing when the schedule already says this', () => {
		const change = scheduleChange(weekdaysOnly, WEEKENDS, new Date('2026-09-12T09:00:00Z'), utc);
		expect(change.insert).toBeNull();
		expect(scheduleChange([], 0, new Date('2026-09-12T09:00:00Z'), utc).insert).toBeNull();
	});

	it('replaces tomorrow’s pending span when saved twice in a day', () => {
		const now = new Date('2026-09-12T09:00:00Z');
		const pending = [...weekdaysOnly, { from: new Date('2026-09-13T00:00:00Z'), restDays: 0 }];
		// Back to weekends off: the pending span goes and nothing replaces it.
		expect(scheduleChange(pending, WEEKENDS, now, utc)).toEqual({
			from: new Date('2026-09-13T00:00:00Z'),
			insert: null
		});
	});

	/**
	 * The test the spec's "done when" asks for. Weekdays only all of September;
	 * on Monday 14 the pilot starts flying every day. The week of 7 September is
	 * still read under the schedule it was flown under, so the weekend it rested
	 * stays rested and its streak stays whole.
	 */
	it('reads an old week under the old schedule after the schedule changed', () => {
		const launched = [{ from: new Date('2026-09-01T00:00:00Z'), restDays: WEEKENDS }];
		const change = scheduleChange(launched, 0, new Date('2026-09-14T10:00:00Z'), utc);
		const spans = [...launched, ...(change.insert ? [change.insert] : [])];
		expect(spans).toHaveLength(2);

		const entries = [
			'2026-09-07T09:00:00Z',
			'2026-09-08T09:00:00Z',
			'2026-09-09T09:00:00Z',
			'2026-09-10T09:00:00Z',
			'2026-09-11T09:00:00Z',
			'2026-09-14T09:00:00Z'
		].map(checkIn);

		// A fortnight later the old weekend is still rest, the new one is owed.
		const later = new Date('2026-09-21T09:00:00Z');
		const snapshot = snapshotGoal(goal(), entries, {
			...utc,
			now: later,
			historyLength: 15,
			restSchedules: spans
		});
		const byDay = new Map(snapshot.history.map((orbit) => [orbit.period.key, orbit]));
		expect(byDay.get('day:2026-09-12')?.dormant).toBe(true);
		expect(byDay.get('day:2026-09-13')?.dormant).toBe(true);
		expect(byDay.get('day:2026-09-19')?.dormant).toBe(false);
		expect(byDay.get('day:2026-09-14')?.dormant).toBe(false);

		// And at the time, the old week read the same as it does now.
		const thenSnapshot = snapshotGoal(goal(), entries, {
			...utc,
			now: new Date('2026-09-14T18:00:00Z'),
			restSchedules: spans
		});
		expect(thenSnapshot.streak).toBe(6);
	});

	it('finds the span in force at an instant, and the newest one', () => {
		const spans = [
			{ from: new Date('2026-09-01T00:00:00Z'), restDays: WEEKENDS },
			{ from: new Date('2026-09-15T00:00:00Z'), restDays: 0 }
		];
		expect(scheduleAt(spans, new Date('2026-09-10T00:00:00Z'))?.restDays).toBe(WEEKENDS);
		expect(scheduleAt(spans, new Date('2026-08-10T00:00:00Z'))).toBeNull();
		expect(latestSchedule(spans)?.restDays).toBe(0);
	});
});

describe('the offline queue on a rest day', () => {
	const saturday = new Date('2026-09-12T18:00:00Z');

	it('wakes a rest day the queue closes', () => {
		const snapshot = snapshotGoal(goal(), [], {
			...utc,
			now: saturday,
			restSchedules: weekdaysOnly
		});
		expect(snapshot.current.dormant).toBe(true);

		const overlaid = overlayQueued(
			snapshot,
			[
				{
					id: 'q-1',
					goalId: 'gym',
					amount: 1,
					note: null,
					occurredAt: new Date('2026-09-12T17:00:00Z'),
					createdAt: new Date('2026-09-12T17:00:00Z')
				}
			],
			utc
		);
		expect(overlaid.current).toMatchObject({ dormant: false, complete: true, rest: true });
		expect(overlaid.totalOrbits).toBe(1);
	});

	it('carries a closed rest day up to the parent counting it', () => {
		const child = goal({ parentId: 'week' });
		const parent = goal({ id: 'week', tier: 'planet', target: 6, title: 'Gym week' });
		const childSnapshot = snapshotGoal(child, [], {
			...utc,
			now: saturday,
			restSchedules: weekdaysOnly
		});
		const parentSnapshot = snapshotDerivedGoal(
			parent,
			[{ goal: child, entries: [], restSchedules: weekdaysOnly }],
			{ ...utc, now: saturday }
		);
		const [, liveParent] = overlayAll(
			[childSnapshot, parentSnapshot],
			[
				{
					id: 'q-1',
					goalId: 'gym',
					amount: 1,
					note: null,
					occurredAt: new Date('2026-09-12T17:00:00Z'),
					createdAt: new Date('2026-09-12T17:00:00Z')
				}
			],
			utc
		);
		expect(liveParent.current.logged).toBe(1);
	});
});

describe('restDayCapacity', () => {
	// Wednesday 16 September 2026; weeks start Monday.
	const now = new Date('2026-09-16T12:00:00Z');
	const week = goal({ id: 'week', tier: 'planet', target: 7 });

	it('counts the flying days a weekday-only child has in the week', () => {
		expect(restDayCapacity(week, [{ goal: goal(), restSchedules: weekdaysOnly }], now, utc)).toBe(
			5
		);
	});

	it('says nothing when no child rests', () => {
		expect(restDayCapacity(week, [{ goal: goal() }], now, utc)).toBeNull();
	});

	it('reads each child under the schedule it flies from now on', () => {
		const changing = [
			...weekdaysOnly,
			{ from: new Date('2026-09-17T00:00:00Z'), restDays: 1 << SUN }
		];
		expect(restDayCapacity(week, [{ goal: goal(), restSchedules: changing }], now, utc)).toBe(6);
	});

	it('warns a parent whose target needs rest days flown, and only then', () => {
		expect(restDayWarning({ tier: 'planet', target: 7 }, 5)).toContain(
			'this week they can close 5 orbits'
		);
		expect(restDayWarning({ tier: 'planet', target: 5 }, 5)).toBeNull();
		expect(restDayWarning({ tier: 'planet', target: 7 }, null)).toBeNull();
	});

	it('adds up across children, counting a child without rest days in full', () => {
		const children = [
			{ goal: goal(), restSchedules: weekdaysOnly },
			{ goal: goal({ id: 'walk' }) }
		];
		expect(restDayCapacity(week, children, now, utc)).toBe(12);
	});
});

describe('goalSchema and rest days', () => {
	const base = {
		title: 'Gym',
		tier: 'satellite',
		metricKind: 'checkin',
		target: '1',
		color: '#a78bfa'
	};

	it('turns the flying days into a rest-day mask', () => {
		const parsed = goalSchema.parse({ ...base, flyingDays: ['1', '2', '3', '4', '5'] });
		expect(parsed.restDays).toBe(WEEKENDS);
	});

	it('refuses a satellite that never flies, and suggests archiving', () => {
		const parsed = goalSchema.safeParse({ ...base, flyingDays: [] });
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]).toMatchObject({
				path: ['flyingDays'],
				message: REST_EVERY_DAY_MESSAGE
			});
		}
		expect(REST_EVERY_DAY_MESSAGE).toContain('archive');
	});

	it('leaves the schedule alone when the form did not offer it', () => {
		expect(goalSchema.parse(base).restDays).toBeNull();
	});

	it('saves "flies every day" for any other tier', () => {
		const planet = goalSchema.parse({ ...base, tier: 'planet', flyingDays: ['1'] });
		expect(planet.restDays).toBe(0);
	});
});
