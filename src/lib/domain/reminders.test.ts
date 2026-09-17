import { describe, expect, it } from 'vitest';
import { periodFor } from './period';
import { buildOrbit, type GoalSnapshot } from './progress';
import {
	DEFAULT_QUIET_HOURS,
	alreadyRemindedToday,
	formatMinuteOfDay,
	inQuietHours,
	minuteOfDay,
	parseMinuteOfDay,
	reminderFor,
	reminderMessage
} from './reminders';
import { cadenceOf } from './tiers';
import type { Goal } from './types';

const options = { timeZone: 'UTC' };
const denver = 'America/Denver';

/** An evening: a satellite's day is in its last quarter, a week's is not. */
const evening = new Date('2026-09-16T21:00:00Z');

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Something private',
		description: null,
		tier: 'satellite',
		metric: { kind: 'count', unit: 'pages' },
		target: 10,
		color: '#7dd3fc',
		sortOrder: 0,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		archivedAt: null,
		parentId: null,
		...overrides
	};
}

function snapshot(
	logged: number,
	overrides: Partial<Goal> = {},
	extra: { streak?: number; dormant?: boolean; derived?: GoalSnapshot['derived']; at?: Date } = {}
): GoalSnapshot {
	const subject = goal(overrides);
	const period = periodFor(extra.at ?? evening, cadenceOf(subject.tier), options);
	const current = buildOrbit(period, logged, subject.target, extra.dormant ?? false);
	return {
		goal: subject,
		current,
		history: [current],
		streak: extra.streak ?? 0,
		totalOrbits: 0,
		lifetimeLogged: logged,
		derived: extra.derived ?? null
	};
}

describe('minuteOfDay', () => {
	it('reads the wall clock where the user is, not where the server is', () => {
		expect(minuteOfDay(new Date('2026-09-16T21:00:00Z'), 'UTC')).toBe(21 * 60);
		expect(minuteOfDay(new Date('2026-09-16T21:00:00Z'), denver)).toBe(15 * 60);
	});

	it('follows a zone across a daylight saving transition', () => {
		// 06:00 UTC is 23:00 the evening before in Denver on standard time, and
		// midnight on daylight time.
		expect(minuteOfDay(new Date('2026-03-08T06:00:00Z'), denver)).toBe(23 * 60);
		expect(minuteOfDay(new Date('2026-03-09T06:00:00Z'), denver)).toBe(0);
	});
});

describe('inQuietHours', () => {
	it('covers a window that crosses midnight', () => {
		const at = (iso: string) => inQuietHours(new Date(iso), 'UTC', DEFAULT_QUIET_HOURS);
		expect(at('2026-09-16T21:59:00Z')).toBe(false);
		expect(at('2026-09-16T22:00:00Z')).toBe(true);
		expect(at('2026-09-17T03:00:00Z')).toBe(true);
		expect(at('2026-09-17T06:59:00Z')).toBe(true);
		expect(at('2026-09-17T07:00:00Z')).toBe(false);
	});

	it('covers a window inside one day', () => {
		const quiet = { from: 9 * 60, until: 17 * 60 };
		expect(inQuietHours(new Date('2026-09-16T12:00:00Z'), 'UTC', quiet)).toBe(true);
		expect(inQuietHours(new Date('2026-09-16T18:00:00Z'), 'UTC', quiet)).toBe(false);
	});

	it('is decided in the user’s zone, so an instant is quiet in one and not another', () => {
		const instant = new Date('2026-09-17T05:00:00Z');
		expect(inQuietHours(instant, 'UTC', DEFAULT_QUIET_HOURS)).toBe(true);
		// 23:00 the evening before in Denver — also quiet, for a different reason.
		expect(inQuietHours(instant, denver, DEFAULT_QUIET_HOURS)).toBe(true);
		// Mid-afternoon in Denver, and 21:00 in UTC: quiet in neither.
		expect(inQuietHours(new Date('2026-09-16T21:00:00Z'), denver, DEFAULT_QUIET_HOURS)).toBe(false);
	});

	it('treats an empty window as no quiet hours at all', () => {
		const none = { from: 0, until: 0 };
		expect(inQuietHours(new Date('2026-09-16T03:00:00Z'), 'UTC', none)).toBe(false);
	});
});

describe('parseMinuteOfDay and formatMinuteOfDay', () => {
	it('round-trips what a time input sends', () => {
		expect(parseMinuteOfDay('22:00')).toBe(22 * 60);
		expect(parseMinuteOfDay('07:30')).toBe(7 * 60 + 30);
		expect(formatMinuteOfDay(22 * 60)).toBe('22:00');
		expect(formatMinuteOfDay(7 * 60 + 30)).toBe('07:30');
	});

	it('refuses anything that is not a wall clock', () => {
		for (const value of ['', '24:00', '7:30', '22:60', 'evening']) {
			expect(parseMinuteOfDay(value)).toBeNull();
		}
	});

	it('wraps rather than printing a 25th hour', () => {
		expect(formatMinuteOfDay(24 * 60)).toBe('00:00');
		expect(formatMinuteOfDay(-60)).toBe('23:00');
	});
});

describe('alreadyRemindedToday', () => {
	it('counts the cap in the user’s own day', () => {
		const sent = new Date('2026-09-16T21:00:00Z');
		expect(alreadyRemindedToday(sent, new Date('2026-09-16T23:00:00Z'), 'UTC')).toBe(true);
		expect(alreadyRemindedToday(sent, new Date('2026-09-17T00:05:00Z'), 'UTC')).toBe(false);
	});

	it('uses the zone, so a late reminder is not spent on the following day', () => {
		// 21:00 UTC is 15:00 in Denver; 02:00 UTC the next day is still the 16th
		// there, so the day's one reminder is already gone.
		const sent = new Date('2026-09-16T21:00:00Z');
		expect(alreadyRemindedToday(sent, new Date('2026-09-17T02:00:00Z'), denver)).toBe(true);
		expect(alreadyRemindedToday(sent, new Date('2026-09-17T02:00:00Z'), 'UTC')).toBe(false);
	});

	it('says nothing has been sent when nothing has', () => {
		expect(alreadyRemindedToday(null, evening, 'UTC')).toBe(false);
	});
});

describe('reminderFor', () => {
	it('nudges a satellite left unclosed late in the day', () => {
		const reminder = reminderFor([snapshot(7)], evening);
		expect(reminder?.kind).toBe('closing');
		expect(reminder?.count).toBe(1);
	});

	it('says nothing about the same satellite in the morning', () => {
		// The day ends within a day at every hour, which is exactly why that on its
		// own is not a rule: at 09:00 there is nothing to report.
		const morning = new Date('2026-09-16T09:00:00Z');
		expect(reminderFor([snapshot(0, {}, { at: morning })], morning)).toBeNull();
		expect(reminderFor([snapshot(0, {}, { at: morning, streak: 5 })], morning)).toBeNull();
	});

	it('never nudges an orbit that has already closed', () => {
		expect(reminderFor([snapshot(10)], evening)).toBeNull();
		// Nor one that closed with room to spare.
		expect(reminderFor([snapshot(14)], evening)).toBeNull();
	});

	it('never nudges a dormant orbit, however late it is', () => {
		expect(reminderFor([snapshot(0, {}, { dormant: true })], evening)).toBeNull();
	});

	it('never nudges a derived goal, which has nothing logged against it', () => {
		const derived = snapshot(0, { tier: 'planet' }, { derived: { children: [] } });
		expect(reminderFor([derived], evening)).toBeNull();
	});

	it('speaks up for any period ending within a day and well short', () => {
		// A weekly goal at 20% with the week ending tonight.
		const endOfWeek = new Date('2026-09-20T20:00:00Z');
		const weekly = snapshot(2, { tier: 'planet' }, { at: endOfWeek });
		const reminder = reminderFor([weekly], endOfWeek);
		expect(reminder?.kind).toBe('deadline');
		expect(reminder?.cadence).toBe('week');
	});

	it('leaves a period ending within a day alone once it is over half way', () => {
		const endOfWeek = new Date('2026-09-20T20:00:00Z');
		const weekly = snapshot(8, { tier: 'planet' }, { at: endOfWeek });
		expect(reminderFor([weekly], endOfWeek)).toBeNull();
	});

	it('leaves a yearly goal alone in September, however little is logged', () => {
		expect(reminderFor([snapshot(0, { tier: 'universe', target: 100 })], evening)).toBeNull();
	});

	it('puts a streak about to break ahead of everything else', () => {
		const plain = snapshot(0, { id: 'plain' });
		const streaked = snapshot(1, { id: 'streaked' }, { streak: 9 });
		const reminder = reminderFor([plain, streaked], evening);

		expect(reminder?.kind).toBe('streak');
		expect(reminder?.goalId).toBe('streaked');
		expect(reminder?.streak).toBe(9);
	});

	it('does not call a streak of one at risk', () => {
		expect(reminderFor([snapshot(7, {}, { streak: 1 })], evening)?.kind).toBe('closing');
	});

	it('counts the orbits in the same trouble rather than listing them', () => {
		const reminder = reminderFor(
			[snapshot(1, { id: 'a' }), snapshot(2, { id: 'b' }), snapshot(10, { id: 'done' })],
			evening
		);
		expect(reminder?.count).toBe(2);
	});

	it('picks the most pressing orbit within a kind', () => {
		const nearlyThere = snapshot(9, { id: 'nearly' });
		const untouched = snapshot(0, { id: 'untouched' });
		expect(reminderFor([nearlyThere, untouched], evening)?.goalId).toBe('untouched');
	});

	it('says nothing at all when nothing is at risk', () => {
		expect(reminderFor([], evening)).toBeNull();
	});
});

describe('reminderMessage', () => {
	const titles = ['Something private', 'Therapy homework', 'Job applications'];

	function messagesFor(): string[] {
		const kinds = [
			reminderFor([snapshot(1, {}, { streak: 4 })], evening),
			reminderFor(
				[snapshot(1, { tier: 'planet' }, { at: new Date('2026-09-20T20:00:00Z') })],
				new Date('2026-09-20T20:00:00Z')
			),
			reminderFor([snapshot(7)], evening)
		];
		return kinds.flatMap((reminder) => {
			const message = reminderMessage(reminder!);
			return [message.title, message.body];
		});
	}

	it('never carries the goal’s own words, whatever the rule', () => {
		const text = messagesFor().join(' ');
		for (const title of titles) expect(text).not.toContain(title);
		expect(text).not.toContain('goal-1');
	});

	it('sends the tap to the view that can do something about it', () => {
		const reminder = reminderFor([snapshot(7)], evening);
		expect(reminderMessage(reminder!).url).toBe('/today');
	});

	it('replaces an unread reminder of the same kind rather than stacking', () => {
		const reminder = reminderFor([snapshot(7)], evening);
		expect(reminderMessage(reminder!).tag).toBe('nova-closing');
	});

	it('counts in words that agree with themselves', () => {
		const one = reminderMessage({
			kind: 'closing',
			cadence: 'day',
			count: 1,
			streak: 0,
			goalId: 'a'
		});
		const two = reminderMessage({
			kind: 'closing',
			cadence: 'day',
			count: 2,
			streak: 0,
			goalId: 'a'
		});
		expect(one.body).toContain('1 orbit has');
		expect(two.body).toContain('2 orbits have');
	});

	it('names the cadence the orbit is actually on', () => {
		const weekly = reminderMessage({
			kind: 'deadline',
			cadence: 'week',
			count: 1,
			streak: 0,
			goalId: 'a'
		});
		expect(weekly.body).toContain('this week');
	});
});
