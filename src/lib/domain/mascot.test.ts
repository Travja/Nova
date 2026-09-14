import { describe, expect, it } from 'vitest';
import { ADRIFT_SHORTFALL, mascotFor } from './mascot';
import { periodFor } from './period';
import { buildOrbit, focusForToday, type GoalSnapshot } from './progress';
import type { Goal } from './types';

const now = new Date('2026-09-12T18:00:00Z');
const options = { timeZone: 'UTC' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Read pages',
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

/** A snapshot whose current orbit sits wherever the test needs it. */
function snapshot(logged: number, overrides: Partial<Goal> = {}): GoalSnapshot {
	const target = overrides.target ?? 10;
	const subject = goal({ ...overrides, target });
	const period = periodFor(now, subject.tier === 'satellite' ? 'day' : 'year', options);
	const current = buildOrbit(period, logged, target);
	return {
		goal: subject,
		current,
		history: [current],
		streak: 0,
		totalOrbits: 0,
		lifetimeLogged: logged
	};
}

/** A yearly goal in September is in flight with months to run. */
function yearly(logged: number, id = 'goal-year'): GoalSnapshot {
	return snapshot(logged, { id, tier: 'universe', target: 100, title: 'Run 1000km' });
}

describe('mascotFor', () => {
	it('rests when everything that could close has closed', () => {
		const state = mascotFor(focusForToday([snapshot(10)], now));
		expect(state.mood).toBe('resting');
		expect(state.closed).toBe(1);
	});

	it('rests when there is nothing in orbit at all', () => {
		expect(mascotFor(focusForToday([], now)).mood).toBe('resting');
	});

	it('works when something is in flight, on pace, with time to spare', () => {
		// A universe goal at 70% in September is neither closing nor behind.
		const state = mascotFor(focusForToday([yearly(70)], now));
		expect(state.mood).toBe('working');
		expect(state.subject?.goal.id).toBe('goal-year');
	});

	it('goes alert, pointing at the orbit that needs attention', () => {
		// A satellite is always within a day of closing; at 80% there is little
		// left to do and every reason to say so.
		const state = mascotFor(focusForToday([snapshot(8), yearly(70)], now));
		expect(state.mood).toBe('alert');
		expect(state.subject?.goal.id).toBe('goal-1');
		expect(state.atRisk).toBe(1);
		expect(state.steady).toBe(1);
	});

	it('drifts once a closing period is well short of its target', () => {
		const short = Math.floor(10 * ADRIFT_SHORTFALL) - 1;
		expect(mascotFor(focusForToday([snapshot(short)], now)).mood).toBe('adrift');
	});

	it('stays alert rather than adrift while more than half is in', () => {
		const nearly = Math.ceil(10 * ADRIFT_SHORTFALL) + 1;
		expect(mascotFor(focusForToday([snapshot(nearly)], now)).mood).toBe('alert');
	});

	it('takes its subject from the most urgent orbit, not the first goal', () => {
		const state = mascotFor(focusForToday([snapshot(9), snapshot(1, { id: 'goal-2' })], now));
		expect(state.subject?.goal.id).toBe('goal-2');
	});

	it('never drifts over a goal that is merely behind pace with months to run', () => {
		// Nothing logged all year is behind pace, but December is a long way off.
		const state = mascotFor(focusForToday([yearly(0)], now));
		expect(state.mood).toBe('alert');
	});
});
