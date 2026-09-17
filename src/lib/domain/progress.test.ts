import { describe, expect, it } from 'vitest';
import { periodFor } from './period';
import { cadenceOf } from './tiers';
import {
	PACE_TOLERANCE,
	buildOrbit,
	closingWindowFor,
	focusForToday,
	formatAmount,
	formatTimeLeft,
	isBehindPace,
	isClosing,
	orbitStanding,
	paceDeficit,
	periodElapsed,
	quickLogSteps,
	singularize,
	snapshotGoal,
	streakFrom,
	urgency
} from './progress';
import type { FocusRow } from './progress';
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
		parentId: null,
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

	it('steps over the periods a goal spent archived', () => {
		// Archived on 22 August, restored on the morning of 12 September: the two
		// whole weeks in between were never missed, they were parked.
		const snapshot = snapshotGoal(
			goal(),
			[
				entry('2026-08-20T10:00:00Z', 120), // week of 17 Aug, closed
				entry('2026-08-13T10:00:00Z', 120) // week of 10 Aug, closed
			],
			{
				...options,
				dormantWindows: [
					{ from: new Date('2026-08-22T00:00:00Z'), until: new Date('2026-09-12T09:00:00Z') }
				]
			}
		);

		expect(snapshot.history[1].dormant).toBe(true);
		expect(snapshot.history[2].dormant).toBe(true);
		expect(snapshot.streak).toBe(2);
	});

	it('freezes rather than breaks a streak while a goal is still archived', () => {
		const archivedAt = new Date('2026-08-22T00:00:00Z');
		const snapshot = snapshotGoal(
			goal({ archivedAt }),
			[entry('2026-08-20T10:00:00Z', 120), entry('2026-08-13T10:00:00Z', 120)],
			{ ...options, dormantWindows: [{ from: archivedAt, until: null }] }
		);
		expect(snapshot.streak).toBe(2);
	});

	it('repairs a broken streak when a backdated entry closes the missed orbit', () => {
		const logged = [
			entry('2026-09-12T10:00:00Z', 120), // this week, closed
			entry('2026-08-27T10:00:00Z', 120) // week of 24 Aug, closed
		];
		// The week of 31 August was missed, so the streak stops at this week.
		expect(snapshotGoal(goal(), logged, options).streak).toBe(1);

		const repaired = snapshotGoal(goal(), [...logged, entry('2026-09-02T10:00:00Z', 120)], options);
		expect(repaired.streak).toBe(3);
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

	it('gives the newest orbit the goal was awake for the benefit of the doubt', () => {
		const period = periodFor(options.now, 'week', options);
		const history = [
			buildOrbit(period, 0, 120, true), // archived, no orbit expected
			buildOrbit(period, 30, 120), // interrupted mid-week by archiving
			buildOrbit(period, 120, 120)
		];
		expect(streakFrom(history)).toBe(1);
	});

	it('is zero when nothing has closed', () => {
		const period = periodFor(options.now, 'week', options);
		expect(streakFrom([buildOrbit(period, 10, 120)])).toBe(0);
	});
});

describe('periodElapsed', () => {
	it('reads the span from the period rather than assuming a length', () => {
		// 8 March 2026 is 23 hours long in Denver, so noon is past the halfway mark.
		const denver = { timeZone: 'America/Denver' };
		const springForward = periodFor(new Date('2026-03-08T12:00:00Z'), 'day', denver);
		expect(springForward.end.getTime() - springForward.start.getTime()).toBe(23 * 3_600_000);
		// Denver's 8 March starts at 07:00Z, so the halfway mark is 11h30m later.
		expect(periodElapsed(springForward, new Date('2026-03-08T18:30:00Z'))).toBeCloseTo(0.5, 2);
	});

	it('clamps outside its own bounds', () => {
		const period = periodFor(options.now, 'week', options);
		expect(periodElapsed(period, period.start)).toBe(0);
		expect(periodElapsed(period, new Date(period.start.getTime() - 1_000))).toBe(0);
		expect(periodElapsed(period, period.end)).toBe(1);
	});
});

describe('urgency', () => {
	const year = periodFor(new Date('2026-06-01T00:00:00Z'), 'year', options);

	it('grows as the period runs out at the same standing', () => {
		const january = urgency(buildOrbit(year, 1.2, 12), new Date('2026-01-15T00:00:00Z'));
		const november = urgency(buildOrbit(year, 1.2, 12), new Date('2026-11-15T00:00:00Z'));
		expect(january).toBeLessThan(0.1);
		expect(november).toBeGreaterThan(0.7);
	});

	it('grows as more of the target is missing at the same point', () => {
		const now = new Date('2026-11-15T00:00:00Z');
		const behind = urgency(buildOrbit(year, 1.2, 12), now);
		const nearlyThere = urgency(buildOrbit(year, 11, 12), now);
		expect(behind).toBeGreaterThan(nearlyThere);
	});

	it('is zero for a closed orbit', () => {
		expect(urgency(buildOrbit(year, 12, 12), new Date('2026-11-15T00:00:00Z'))).toBe(0);
	});

	it('is zero for a dormant orbit, however late the period is', () => {
		const dormant = buildOrbit(year, 0, 12, true);
		expect(urgency(dormant, new Date('2026-12-31T00:00:00Z'))).toBe(0);
	});
});

describe('closingWindowFor', () => {
	const denver = { timeZone: 'America/Denver' };
	const hours = (period: Parameters<typeof closingWindowFor>[0]) =>
		closingWindowFor(period) / 3_600_000;

	it('gives a day its last six hours', () => {
		expect(hours(periodFor(new Date('2026-09-12T06:00:00Z'), 'day', options))).toBe(6);
	});

	it('gives a week its last 42 hours', () => {
		expect(hours(periodFor(new Date('2026-09-12T06:00:00Z'), 'week', options))).toBe(42);
	});

	it('scales with a month rather than assuming one length', () => {
		// 30 days is 7½; February is shorter, and says so.
		expect(hours(periodFor(new Date('2026-09-12T06:00:00Z'), 'month', options))).toBe(180);
		expect(hours(periodFor(new Date('2026-02-12T06:00:00Z'), 'month', options))).toBe(168);
	});

	it('caps the long cadences at a fortnight', () => {
		expect(hours(periodFor(new Date('2026-09-12T06:00:00Z'), 'quarter', options))).toBe(14 * 24);
		expect(hours(periodFor(new Date('2026-09-12T06:00:00Z'), 'year', options))).toBe(14 * 24);
	});

	it('follows a day across a daylight saving transition, in both directions', () => {
		// 8 March 2026 is 23 hours long in Denver and 1 November is 25, so the
		// window is a quarter of each rather than a quarter of a nominal day.
		const spring = periodFor(new Date('2026-03-08T18:00:00Z'), 'day', denver);
		const autumn = periodFor(new Date('2026-11-01T18:00:00Z'), 'day', denver);
		expect(hours(spring)).toBeCloseTo(5.75, 10);
		expect(hours(autumn)).toBeCloseTo(6.25, 10);
	});
});

describe('isClosing', () => {
	const day = periodFor(new Date('2026-09-12T06:00:00Z'), 'day', options);
	const year = periodFor(new Date('2026-09-12T06:00:00Z'), 'year', options);

	it('leaves a satellite alone until the last quarter of its day', () => {
		expect(isClosing(buildOrbit(day, 0, 1), new Date('2026-09-12T00:01:00Z'))).toBe(false);
		expect(isClosing(buildOrbit(day, 0, 1), new Date('2026-09-12T17:59:00Z'))).toBe(false);
		expect(isClosing(buildOrbit(day, 0, 1), new Date('2026-09-12T18:00:00Z'))).toBe(true);
		expect(isClosing(buildOrbit(day, 0, 1), new Date('2026-09-12T23:00:00Z'))).toBe(true);
	});

	it('leaves a yearly goal alone in October, and flags it in the last fortnight', () => {
		expect(isClosing(buildOrbit(year, 1, 12), new Date('2026-10-15T06:00:00Z'))).toBe(false);
		expect(isClosing(buildOrbit(year, 1, 12), new Date('2026-12-10T06:00:00Z'))).toBe(false);
		expect(isClosing(buildOrbit(year, 1, 12), new Date('2026-12-31T06:00:00Z'))).toBe(true);
	});

	it('never flags a closed or dormant orbit', () => {
		const now = new Date('2026-09-12T23:00:00Z');
		expect(isClosing(buildOrbit(day, 1, 1), now)).toBe(false);
		expect(isClosing(buildOrbit(day, 0, 1, true), now)).toBe(false);
	});
});

describe('paceDeficit and isBehindPace', () => {
	const year = periodFor(new Date('2026-06-01T00:00:00Z'), 'year', options);
	const week = periodFor(new Date('2026-09-12T06:00:00Z'), 'week', options);
	/** Half way through 2026, give or take a few hours. */
	const midYear = new Date('2026-07-02T12:00:00Z');
	const launched = new Date('2026-01-01T00:00:00Z');

	it('measures the gap between the pace and the standing', () => {
		// 35% of a 12-unit target, half way through the year.
		expect(paceDeficit(buildOrbit(year, 4.2, 12), launched, midYear)).toBeCloseTo(0.15, 2);
		expect(isBehindPace(buildOrbit(year, 4.2, 12), launched, midYear)).toBe(true);
	});

	it('allows a tenth of the period as slack, since work comes in bursts', () => {
		// 44% logged against 50% elapsed is behind, but not by enough to nag.
		expect(isBehindPace(buildOrbit(year, 5.3, 12), launched, midYear)).toBe(false);
		expect(isBehindPace(buildOrbit(year, 4.7, 12), launched, midYear)).toBe(true);
	});

	it('is negative and quiet for a goal running ahead', () => {
		expect(paceDeficit(buildOrbit(year, 10, 12), launched, midYear)).toBeLessThan(0);
		expect(isBehindPace(buildOrbit(year, 10, 12), launched, midYear)).toBe(false);
	});

	it('says nothing until a third of the period has run', () => {
		// Monday evening is not behind on a week, however little is logged.
		const mondayEvening = new Date('2026-09-07T18:00:00Z');
		expect(isBehindPace(buildOrbit(week, 0, 120), launched, mondayEvening)).toBe(false);
		// By Thursday morning the week is a third gone and nothing is logged.
		expect(isBehindPace(buildOrbit(week, 0, 120), launched, new Date('2026-09-10T12:00:00Z'))).toBe(
			true
		);
	});

	it('never holds a day to a pace, however much of it has gone', () => {
		// The hours a day has spent are not a measure of whether it is behind: the
		// work lands in a block at an hour of the pilot's choosing. What the day
		// has instead is a deadline, which `isClosing` raises in its last quarter.
		const day = periodFor(new Date('2026-09-12T10:00:00Z'), 'day', options);
		const nothingLogged = buildOrbit(day, 0, 10);
		for (const hour of [8, 10, 12, 16, 20, 23]) {
			const now = new Date(`2026-09-12T${String(hour).padStart(2, '0')}:00:00Z`);
			expect(isBehindPace(nothingLogged, launched, now)).toBe(false);
			// The gap is still there to read — it is only the nagging that is withheld.
			expect(paceDeficit(nothingLogged, launched, now)).toBeGreaterThan(PACE_TOLERANCE);
		}
		expect(isClosing(nothingLogged, new Date('2026-09-12T20:00:00Z'))).toBe(true);
	});

	it('does not hold a goal to the part of the period it missed', () => {
		// Launched three days ago, on a yearly orbit: at the start of its first
		// orbit, not half a year into it.
		const justLaunched = new Date('2026-06-29T12:00:00Z');
		expect(paceDeficit(buildOrbit(year, 0, 12), justLaunched, midYear)).toBeLessThan(
			PACE_TOLERANCE
		);
		expect(isBehindPace(buildOrbit(year, 0, 12), justLaunched, midYear)).toBe(false);
	});

	it('never nags about a closed or dormant orbit', () => {
		expect(isBehindPace(buildOrbit(year, 12, 12), launched, midYear)).toBe(false);
		expect(isBehindPace(buildOrbit(year, 0, 12, true), launched, midYear)).toBe(false);
		expect(paceDeficit(buildOrbit(year, 0, 12, true), launched, midYear)).toBe(0);
	});
});

describe('focusForToday', () => {
	// New Year's Eve, late enough to be inside every cadence's closing window:
	// every cadence closes at the same instant, which is exactly when the
	// ordering has to say something other than "by tier".
	const now = new Date('2026-12-31T19:00:00Z');
	/** Mid-quarter, so nothing longer than a day is anywhere near its deadline. */
	const november = new Date('2026-11-01T12:00:00Z');
	/** Half way through the year: far from every deadline, and past the pace grace. */
	const july = new Date('2026-07-02T12:00:00Z');

	function ids(rows: FocusRow[]): string[] {
		return rows.map((row) => row.snapshot.goal.id);
	}

	function snapshotFor(overrides: Partial<Goal>, logged: number, dormant = false, at: Date = now) {
		const subject = goal(overrides);
		const period = periodFor(at, cadenceOf(subject.tier), options);
		return {
			goal: subject,
			current: buildOrbit(period, logged, subject.target, dormant),
			history: [],
			streak: 0,
			totalOrbits: 0,
			lifetimeLogged: logged
		};
	}

	it('sorts what is at risk by pressure, not by tier', () => {
		// The satellite is 80% of the way through today; the year is at 10% with
		// hours to go, so it is the one in trouble.
		const satellite = snapshotFor({ id: 'sat', tier: 'satellite', target: 10 }, 8);
		const lateYear = snapshotFor({ id: 'year', tier: 'universe', target: 12 }, 1.2);
		const focus = focusForToday([satellite, lateYear], now);

		expect(ids(focus.atRisk)).toEqual(['year', 'sat']);
	});

	it('calls out a goal behind pace with its deadline still far off', () => {
		// Half way through the year at 35%: nothing is closing, but this needs
		// attention all the same.
		const behind = snapshotFor({ id: 'novel', tier: 'universe', target: 12 }, 4.2, false, july);
		const focus = focusForToday([behind], july);

		expect(ids(focus.atRisk)).toEqual(['novel']);
		expect(focus.atRisk[0].behindPace).toBe(true);
		expect(focus.atRisk[0].closing).toBe(false);
		expect(focus.steady).toEqual([]);
	});

	it('leaves a goal on pace out of it entirely', () => {
		const onPace = snapshotFor({ id: 'novel', tier: 'universe', target: 12 }, 6, false, july);
		const focus = focusForToday([onPace], july);

		expect(focus.atRisk).toEqual([]);
		expect(ids(focus.steady)).toEqual(['novel']);
	});

	it('collapses the closed ones out of the list rather than dropping them', () => {
		const closed = snapshotFor({ id: 'done', tier: 'satellite', target: 10 }, 10);
		const open = snapshotFor({ id: 'todo', tier: 'satellite', target: 10 }, 0);
		const focus = focusForToday([closed, open], now);

		expect(focus.closed.map((snapshot) => snapshot.goal.id)).toEqual(['done']);
		expect(ids(focus.atRisk)).toEqual(['todo']);
	});

	it('parks a goal with room left as steady rather than actionable', () => {
		// A month into the quarter with over a quarter of the target logged: short
		// of the pace, but inside the slack the pace rule allows.
		const quarter = snapshotFor({ id: 'galaxy', tier: 'galaxy', target: 30 }, 8, false, november);
		const focus = focusForToday([quarter], november);

		expect(focus.atRisk).toEqual([]);
		expect(ids(focus.steady)).toEqual(['galaxy']);
	});

	it('ranks the ones that can wait by urgency as well', () => {
		// Two goals on the same quarter, both still on pace. The one with further to
		// go is not work today, but it is the first thing that becomes work.
		const behind = snapshotFor(
			{ id: 'behind', tier: 'galaxy', target: 30, sortOrder: 1 },
			9,
			false,
			november
		);
		const ahead = snapshotFor(
			{ id: 'ahead', tier: 'galaxy', target: 30, sortOrder: 0 },
			25,
			false,
			november
		);
		const focus = focusForToday([ahead, behind], november);

		expect(ids(focus.steady)).toEqual(['behind', 'ahead']);
	});

	it('never parks a satellite as steady, however well it is going', () => {
		// Ten in the morning with nine of ten logged: nothing is wrong with it, and
		// it is still owed before tonight — which is not what steady promises.
		const morning = new Date('2026-12-31T10:00:00Z');
		const satellite = snapshotFor(
			{ id: 'stretch', tier: 'satellite', target: 10 },
			9,
			false,
			morning
		);
		const focus = focusForToday([satellite], morning);

		expect(focus.steady).toEqual([]);
		expect(ids(focus.atRisk)).toEqual(['stretch']);
		expect(focus.atRisk[0].owedToday).toBe(true);
	});

	it('does not call a satellite behind pace for having a day still to run', () => {
		// The same morning, nothing logged at all. It is pending, which is not the
		// same as being in trouble: the hours gone are not the measure, the
		// deadline is, and it is hours away yet.
		const morning = new Date('2026-12-31T10:00:00Z');
		const satellite = snapshotFor(
			{ id: 'stretch', tier: 'satellite', target: 10 },
			0,
			false,
			morning
		);
		const focus = focusForToday([satellite], morning);

		expect(ids(focus.atRisk)).toEqual(['stretch']);
		expect(focus.atRisk[0].behindPace).toBe(false);
		expect(focus.atRisk[0].closing).toBe(false);
	});

	it('marks the same satellite closing once its day is nearly done', () => {
		// Seven in the evening, the last quarter of the day. It was pending all
		// along; now the deadline is the reason, which is the signal a day has.
		const satellite = snapshotFor({ id: 'stretch', tier: 'satellite', target: 10 }, 9);
		const focus = focusForToday([satellite], now);

		expect(ids(focus.atRisk)).toEqual(['stretch']);
		expect(focus.atRisk[0].closing).toBe(true);
	});

	it('ranks a satellite among the other tiers rather than beside them', () => {
		// Mid-December, ten in the morning. The quarter at 20% with a fortnight
		// and a bit to run outranks a satellite with the whole day ahead of it,
		// and the satellite outranks a quarter that is nearly done. One list,
		// ordered by pressure — the tier decides nothing.
		const midDecember = new Date('2026-12-15T10:00:00Z');
		const late = snapshotFor({ id: 'late', tier: 'galaxy', target: 30 }, 6, false, midDecember);
		const sat = snapshotFor({ id: 'sat', tier: 'satellite', target: 10 }, 0, false, midDecember);
		const easy = snapshotFor({ id: 'easy', tier: 'galaxy', target: 30 }, 28, false, midDecember);
		const focus = focusForToday([sat, late, easy], midDecember);

		expect(ids(focus.atRisk)).toEqual(['late', 'sat']);
		expect(ids(focus.steady)).toEqual(['easy']);
	});

	it('keeps a dormant orbit out of the at-risk list', () => {
		const dormant = snapshotFor({ id: 'asleep', tier: 'satellite', target: 10 }, 0, true);
		const focus = focusForToday([dormant], now);

		expect(focus.atRisk).toEqual([]);
		expect(ids(focus.steady)).toEqual(['asleep']);
	});

	it("breaks a tie on the nearer deadline, then the pilot's own order", () => {
		const first = snapshotFor({ id: 'a', tier: 'satellite', target: 10, sortOrder: 0 }, 0);
		const second = snapshotFor({ id: 'b', tier: 'satellite', target: 10, sortOrder: 1 }, 0);
		const focus = focusForToday([second, first], now);

		expect(ids(focus.atRisk)).toEqual(['a', 'b']);
	});
});

describe('formatTimeLeft', () => {
	const day = periodFor(new Date('2026-09-12T06:00:00Z'), 'day', options);
	const year = periodFor(new Date('2026-09-12T06:00:00Z'), 'year', options);

	it('counts down in the coarsest unit that still says something', () => {
		expect(formatTimeLeft(day, new Date('2026-09-12T23:30:00Z'))).toBe('30m left');
		expect(formatTimeLeft(day, new Date('2026-09-12T18:00:00Z'))).toBe('6h left');
		expect(formatTimeLeft(year, new Date('2026-12-30T00:00:00Z'))).toBe('2 days left');
		expect(formatTimeLeft(year, new Date('2026-12-31T00:00:00Z'))).toBe('1 day left');
	});

	it('never rounds the last minute down to nothing', () => {
		expect(formatTimeLeft(day, day.end)).toBe('under a minute left');
		expect(formatTimeLeft(day, new Date(day.end.getTime() - 30_000))).toBe('under a minute left');
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

	it('drops the plural on a counted unit at exactly one', () => {
		expect(formatAmount(1, { kind: 'count', unit: 'pages' })).toBe('1 page');
		expect(formatAmount(-1, { kind: 'count', unit: 'pages' })).toBe('-1 page');
		expect(formatAmount(1.5, { kind: 'count', unit: 'pages' })).toBe('1.5 pages');
		expect(formatAmount(0, { kind: 'count', unit: 'pages' })).toBe('0 pages');
		expect(formatAmount(1, { kind: 'count', unit: '' })).toBe('1');
	});
});

describe('singularize', () => {
	it('undoes the regular endings', () => {
		expect(singularize('pages')).toBe('page');
		expect(singularize('workouts')).toBe('workout');
		expect(singularize('entries')).toBe('entry');
		expect(singularize('boxes')).toBe('box');
		expect(singularize('pushes')).toBe('push');
		expect(singularize('glasses')).toBe('glass');
	});

	it('leaves alone anything it cannot reduce safely', () => {
		// Already singular, a mass noun, or only looking plural.
		expect(singularize('chapter')).toBe('chapter');
		expect(singularize('water')).toBe('water');
		expect(singularize('press')).toBe('press');
		expect(singularize('focus')).toBe('focus');
		expect(singularize('analysis')).toBe('analysis');
		expect(singularize('lines')).toBe('line');
	});
});

describe('quickLogSteps', () => {
	const duration = { kind: 'duration', unit: 'minutes' } as const;
	const count = { kind: 'count', unit: 'pages' } as const;

	it('never offers to log more than the goal asks for', () => {
		for (const target of [1, 5, 12, 20, 47, 120, 300]) {
			for (const metric of [duration, count]) {
				for (const step of quickLogSteps(metric, target)) {
					expect(step).toBeLessThanOrEqual(target);
					expect(step).toBeGreaterThan(0);
				}
			}
		}
	});

	it('breaks a short duration down instead of jumping to a quarter hour', () => {
		// The old behaviour offered +15m, +30m, +1h against a five-minute goal.
		expect(quickLogSteps(duration, 5)).toEqual([1, 2, 5]);
	});

	it('still reads naturally at the sizes people actually use', () => {
		expect(quickLogSteps(duration, 120)).toEqual([30, 60, 120]);
		expect(quickLogSteps(duration, 20)).toEqual([5, 10, 20]);
	});

	it('closes the orbit exactly with its largest button', () => {
		for (const target of [5, 20, 60, 120]) {
			const steps = quickLogSteps(duration, target);
			expect(steps.at(-1)).toBe(target);
		}
	});

	it('keeps counts whole', () => {
		expect(quickLogSteps(count, 8)).toEqual([2, 4, 8]);
		expect(quickLogSteps(count, 1)).toEqual([1]);
		expect(quickLogSteps(count, 3).every(Number.isInteger)).toBe(true);
	});

	it('returns ascending, unique, non-empty steps for any sane target', () => {
		for (const target of [1, 2, 3, 7, 47, 1000]) {
			const steps = quickLogSteps(duration, target);
			expect(steps.length).toBeGreaterThan(0);
			expect([...new Set(steps)]).toEqual(steps);
			expect([...steps].sort((a, b) => a - b)).toEqual(steps);
		}
	});

	it('a check-in is one check-in', () => {
		expect(quickLogSteps({ kind: 'checkin', unit: '' }, 1)).toEqual([1]);
		expect(quickLogSteps({ kind: 'checkin', unit: '' }, 30)).toEqual([1]);
	});
});

/**
 * The text equivalent every orbit visual stands behind. `OrbitDial` and
 * `OrbitHistory` both draw decorative SVG and put this beside it, so what it
 * says is the whole of what a screen reader gets — including the dormant case,
 * which the drawing only tells apart by going cold.
 */
describe('orbitStanding', () => {
	const period = periodFor(new Date('2026-09-12T18:00:00Z'), 'week', { timeZone: 'UTC' });

	it('says how much of the target is in', () => {
		expect(orbitStanding(buildOrbit(period, 45, 120))).toBe('38% of target logged');
	});

	it('says an orbit is closed rather than leaving it at 100%', () => {
		expect(orbitStanding(buildOrbit(period, 120, 120))).toBe('orbit closed, 100% of target logged');
	});

	it('keeps the overshoot, which the arc has no way to draw', () => {
		expect(orbitStanding(buildOrbit(period, 168, 120))).toBe('orbit closed, 140% of target logged');
	});

	it('reads a dormant period as archived rather than as a miss', () => {
		// The whole of #7's "not by colour alone": an archived period is drawn
		// grey and still, and nothing else about it says so.
		expect(orbitStanding(buildOrbit(period, 0, 120, true))).toBe(
			'archived for this period, no orbit expected'
		);
	});

	it('does not call an empty period dormant', () => {
		expect(orbitStanding(buildOrbit(period, 0, 120))).toBe('0% of target logged');
	});
});
