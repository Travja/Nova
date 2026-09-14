import { describe, expect, it } from 'vitest';
import { overlayAll, overlayQueued, queuedFor, type QueuedEntry } from './queue';
import { snapshotGoal } from './progress';
import type { Goal } from './types';

const utc = { timeZone: 'UTC' };

function goal(overrides: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		userId: 'user-1',
		title: 'Read pages',
		description: null,
		tier: 'satellite',
		metric: { kind: 'count', unit: 'pages' },
		target: 10,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		archivedAt: null,
		...overrides
	};
}

function queued(iso: string, amount: number, overrides: Partial<QueuedEntry> = {}): QueuedEntry {
	return {
		id: `queued-${iso}-${amount}`,
		goalId: 'goal-1',
		amount,
		note: null,
		occurredAt: new Date(iso),
		createdAt: new Date(iso),
		...overrides
	};
}

describe('queuedFor', () => {
	it('keeps only the entries belonging to one goal', () => {
		const mine = queued('2026-09-14T09:00:00Z', 3);
		const theirs = queued('2026-09-14T09:00:00Z', 5, { id: 'other', goalId: 'goal-2' });
		expect(queuedFor([mine, theirs], 'goal-1')).toEqual([mine]);
	});
});

describe('overlayQueued', () => {
	const now = new Date('2026-09-14T18:00:00Z');

	it('moves the orbit in flight without a round trip', () => {
		const snapshot = snapshotGoal(goal(), [{ amount: 4, occurredAt: now }], { ...utc, now });
		expect(snapshot.current.logged).toBe(4);

		const shown = overlayQueued(snapshot, [queued('2026-09-14T17:00:00Z', 6)], utc);
		expect(shown.current.logged).toBe(10);
		expect(shown.current.complete).toBe(true);
		expect(shown.current.fraction).toBe(1);
		expect(shown.current.angle).toBe(360);
		// The server's snapshot is left exactly as it came.
		expect(snapshot.current.logged).toBe(4);
	});

	it('lands an entry in the orbit it happened in, not the one it is waiting in', () => {
		// Logged on Monday with no signal, still queued on Wednesday.
		const monday = '2026-09-07T10:00:00Z';
		const wednesday = new Date('2026-09-09T10:00:00Z');
		const snapshot = snapshotGoal(goal(), [], { ...utc, now: wednesday });

		const shown = overlayQueued(snapshot, [queued(monday, 10)], utc);

		expect(shown.current.logged).toBe(0);
		expect(shown.current.complete).toBe(false);
		const mondays = shown.history.find((orbit) => orbit.period.key.endsWith('2026-09-07'));
		expect(mondays?.logged).toBe(10);
		expect(mondays?.complete).toBe(true);
	});

	it('carries a negative amount faithfully, and can re-open an orbit with it', () => {
		const snapshot = snapshotGoal(goal(), [{ amount: 12, occurredAt: now }], { ...utc, now });
		expect(snapshot.current.complete).toBe(true);
		expect(snapshot.totalOrbits).toBe(1);

		const shown = overlayQueued(snapshot, [queued('2026-09-14T17:00:00Z', -5)], utc);
		expect(shown.current.logged).toBe(7);
		expect(shown.current.complete).toBe(false);
		expect(shown.totalOrbits).toBe(0);
		expect(shown.lifetimeLogged).toBe(7);
	});

	it('extends the streak the moment a queued entry closes the orbit', () => {
		const entries = [
			{ amount: 10, occurredAt: new Date('2026-09-12T12:00:00Z') },
			{ amount: 10, occurredAt: new Date('2026-09-13T12:00:00Z') }
		];
		const snapshot = snapshotGoal(goal(), entries, { ...utc, now });
		expect(snapshot.streak).toBe(2);
		expect(snapshot.totalOrbits).toBe(2);

		const shown = overlayQueued(snapshot, [queued('2026-09-14T09:00:00Z', 10)], utc);
		expect(shown.streak).toBe(3);
		expect(shown.totalOrbits).toBe(3);
	});

	it('counts an entry from an orbit older than the history towards the lifetime total', () => {
		const snapshot = snapshotGoal(goal(), [], { ...utc, now });
		const ancient = queued('2026-01-05T12:00:00Z', 8);

		const shown = overlayQueued(snapshot, [ancient], utc);

		expect(shown.lifetimeLogged).toBe(8);
		expect(shown.current.logged).toBe(0);
		expect(shown.history.every((orbit) => orbit.logged === 0)).toBe(true);
	});

	it('buckets a queued entry by the day it was in, across a daylight saving jump', () => {
		// 8 March 2026 is 23 hours long in Denver: the clocks go forward at 02:00
		// local, which is 09:00Z. An entry at 08:30Z is still 01:30 on the 8th,
		// and one at 09:30Z is 03:30 on the same day — both belong to the 8th,
		// and neither belongs to the 9th, which a fixed 24-hour offset would give.
		const denver = { timeZone: 'America/Denver' };
		const now = new Date('2026-03-08T20:00:00Z');
		const snapshot = snapshotGoal(goal({ target: 4 }), [], { ...denver, now });

		const shown = overlayQueued(
			snapshot,
			[queued('2026-03-08T08:30:00Z', 1), queued('2026-03-08T09:30:00Z', 1)],
			denver
		);

		expect(shown.current.period.key).toBe('day:2026-03-08');
		expect(shown.current.logged).toBe(2);
		expect(shown.history[1].logged).toBe(0);
	});

	it('returns the snapshot untouched when nothing is queued for that goal', () => {
		const snapshot = snapshotGoal(goal(), [], { ...utc, now });
		expect(overlayQueued(snapshot, [], utc)).toBe(snapshot);
		expect(
			overlayQueued(snapshot, [queued('2026-09-14T09:00:00Z', 3, { goalId: 'other' })], utc)
		).toBe(snapshot);
	});
});

describe('overlayAll', () => {
	it("folds each goal's queue into its own snapshot", () => {
		const now = new Date('2026-09-14T18:00:00Z');
		const first = snapshotGoal(goal(), [], { ...utc, now });
		const second = snapshotGoal(goal({ id: 'goal-2', target: 20 }), [], { ...utc, now });

		const shown = overlayAll(
			[first, second],
			[
				queued('2026-09-14T09:00:00Z', 4),
				queued('2026-09-14T09:00:00Z', 5, { id: 'b', goalId: 'goal-2' })
			],
			utc
		);

		expect(shown[0].current.logged).toBe(4);
		expect(shown[1].current.logged).toBe(5);
	});
});
