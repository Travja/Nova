import { describe, expect, it } from 'vitest';
import {
	CAPTURE_AFTER,
	captureOffer,
	driftAge,
	driftBand,
	driftFraction,
	doneLabel,
	DONE_VISIBLE,
	driftLabel,
	DRIFT_DRIFTING_MS,
	DRIFT_RELEASE_OFFER_MS,
	isAsteroidResolution,
	normalizeTitle,
	atBeltEdge,
	offersRelease,
	recurrenceCount,
	shouldOfferCapture,
	sortBelt,
	type Asteroid,
	type ResolvedAsteroid
} from './asteroids';

const now = new Date('2026-09-17T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** `now` minus this many days, as an instant. */
function daysAgo(days: number): Date {
	return new Date(now.getTime() - days * DAY);
}

function asteroid(overrides: Partial<Asteroid> = {}): Asteroid {
	const createdAt = overrides.createdAt ?? daysAgo(1);
	return {
		id: 'rock-1',
		userId: 'user-1',
		title: 'Clean the garage',
		note: null,
		createdAt,
		driftAnchorAt: createdAt,
		resolution: null,
		resolvedAt: null,
		capturedGoalId: null,
		captureDismissedAt: null,
		...overrides
	};
}

/** A resolved row, timestamped so the walk through history has an order. */
function resolved(
	title: string,
	resolution: ResolvedAsteroid['resolution'],
	daysBack: number,
	captureDismissedAt: Date | null = null
): ResolvedAsteroid {
	return { title, resolution, resolvedAt: daysAgo(daysBack), captureDismissedAt };
}

describe('normalizeTitle', () => {
	it('trims and case-folds, and does nothing else', () => {
		expect(normalizeTitle('  Clean The Garage  ')).toBe('clean the garage');
		expect(normalizeTitle('CLEAN THE GARAGE')).toBe(normalizeTitle('clean the garage'));
	});

	it('does not fuzzy match, on purpose', () => {
		// "clean garage" is the same errand to a person and a different title to
		// Nova. Guessing here means offering to turn the wrong one-off into a
		// habit, which is worse than waiting for an exact repeat.
		expect(normalizeTitle('clean garage')).not.toBe(normalizeTitle('clean the garage'));
	});

	it('folds case beyond ASCII', () => {
		expect(normalizeTitle('Überweisung')).toBe(normalizeTitle('überweisung'));
	});
});

describe('recurrenceCount', () => {
	it('counts clears of the same title, however it was capitalised', () => {
		const history = [
			resolved('Clean the garage', 'cleared', 30),
			resolved('clean the garage  ', 'cleared', 20),
			resolved('Pay the parking fine', 'cleared', 10)
		];
		expect(recurrenceCount('CLEAN THE GARAGE', history)).toBe(2);
	});

	it('resets on a release, which is a vote against recurrence', () => {
		const history = [
			resolved('Clean the garage', 'cleared', 40),
			resolved('Clean the garage', 'cleared', 30),
			resolved('Clean the garage', 'released', 20),
			resolved('Clean the garage', 'cleared', 10)
		];
		expect(recurrenceCount('Clean the garage', history)).toBe(1);
	});

	it('ignores a capture, which already answered the question', () => {
		const history = [
			resolved('Clean the garage', 'cleared', 30),
			resolved('Clean the garage', 'captured', 20),
			resolved('Clean the garage', 'cleared', 10)
		];
		expect(recurrenceCount('Clean the garage', history)).toBe(2);
	});

	it('reads history in resolution order, not list order', () => {
		// The service hands over whatever the database returns; the reset has to
		// land where it happened rather than where the row turned up.
		const history = [
			resolved('Clean the garage', 'cleared', 5),
			resolved('Clean the garage', 'released', 20),
			resolved('Clean the garage', 'cleared', 30)
		];
		expect(recurrenceCount('Clean the garage', history)).toBe(1);
	});

	it('is zero for a title nothing has cleared', () => {
		expect(recurrenceCount('Book the dentist', [resolved('Clean the garage', 'cleared', 5)])).toBe(
			0
		);
	});
});

describe('shouldOfferCapture', () => {
	it('waits for the third clear', () => {
		expect(CAPTURE_AFTER).toBe(3);
		expect(shouldOfferCapture(2)).toBe(false);
		expect(shouldOfferCapture(3)).toBe(true);
		expect(shouldOfferCapture(9)).toBe(true);
	});
});

describe('captureOffer', () => {
	const thrice = [
		resolved('Clean the garage', 'cleared', 30),
		resolved('Clean the garage', 'cleared', 20),
		resolved('Clean the garage', 'cleared', 10)
	];

	it('offers once the count is there', () => {
		expect(captureOffer('Clean the garage', thrice)).toEqual({ count: 3, offer: true });
	});

	it('stays quiet once the offer has been turned down', () => {
		const dismissed = [
			...thrice.slice(0, 2),
			resolved('Clean the garage', 'cleared', 10, daysAgo(10))
		];
		expect(captureOffer('Clean the garage', dismissed)).toEqual({ count: 3, offer: false });
	});

	it('keeps quiet on the clears after a dismissal', () => {
		const dismissed = [
			...thrice.slice(0, 2),
			resolved('Clean the garage', 'cleared', 10, daysAgo(10)),
			resolved('Clean the garage', 'cleared', 5)
		];
		expect(captureOffer('Clean the garage', dismissed)).toEqual({ count: 4, offer: false });
	});

	it('asks again once a release restarts the count', () => {
		const history = [
			...thrice.slice(0, 2),
			resolved('Clean the garage', 'cleared', 12, daysAgo(12)),
			resolved('Clean the garage', 'released', 10),
			resolved('Clean the garage', 'cleared', 8),
			resolved('Clean the garage', 'cleared', 6),
			resolved('Clean the garage', 'cleared', 4)
		];
		expect(captureOffer('Clean the garage', history)).toEqual({ count: 3, offer: true });
	});

	it('does not let a dismissal on one title silence another', () => {
		const history = [
			...thrice.slice(0, 2),
			resolved('Clean the garage', 'cleared', 10, daysAgo(10)),
			resolved('Water the plants', 'cleared', 9),
			resolved('Water the plants', 'cleared', 8),
			resolved('Water the plants', 'cleared', 7)
		];
		expect(captureOffer('Water the plants', history)).toEqual({ count: 3, offer: true });
	});
});

describe('drift', () => {
	it('measures from the anchor, not from creation', () => {
		// A rock created a month ago whose title was rewritten yesterday is a
		// day old as far as the belt is concerned.
		const rewritten = asteroid({ createdAt: daysAgo(30), driftAnchorAt: daysAgo(1) });
		expect(driftAge(rewritten, now)).toBe(DAY);
		expect(driftBand(rewritten, now)).toBe('fresh');
	});

	it('never reads negative, whatever the clock says', () => {
		expect(driftAge(asteroid({ driftAnchorAt: new Date(now.getTime() + DAY) }), now)).toBe(0);
	});

	it('bands on the week and on the release offer', () => {
		const at = (days: number) => driftBand(asteroid({ driftAnchorAt: daysAgo(days) }), now);
		expect(at(0)).toBe('fresh');
		expect(at(6)).toBe('fresh');
		expect(at(7)).toBe('drifting');
		expect(at(20)).toBe('drifting');
		expect(at(21)).toBe('faint');
		expect(at(400)).toBe('faint');
	});

	it('puts the band boundaries exactly on the constants', () => {
		const boundary = (ms: number) =>
			driftBand(asteroid({ driftAnchorAt: new Date(now.getTime() - ms) }), now);
		expect(boundary(DRIFT_DRIFTING_MS - 1)).toBe('fresh');
		expect(boundary(DRIFT_DRIFTING_MS)).toBe('drifting');
		expect(boundary(DRIFT_RELEASE_OFFER_MS - 1)).toBe('drifting');
		expect(boundary(DRIFT_RELEASE_OFFER_MS)).toBe('faint');
	});

	it('reaches the edge of the belt exactly where it goes faint', () => {
		// One fact drawn twice rather than two facts that can disagree — the
		// same move the orbit dial makes with position and fill.
		for (const days of [0, 6, 7, 20, 21, 90]) {
			const rock = asteroid({ driftAnchorAt: daysAgo(days) });
			expect(atBeltEdge(rock, now)).toBe(driftBand(rock, now) === 'faint');
		}
	});

	it('puts letting go on the row the moment the rock starts moving', () => {
		// The controls escalate with the picture: nothing to let go of while it
		// is still fresh, a second ending the moment it visibly drifts.
		for (const days of [0, 6, 7, 20, 21, 90]) {
			const rock = asteroid({ driftAnchorAt: daysAgo(days) });
			expect(offersRelease(rock, now)).toBe(driftBand(rock, now) !== 'fresh');
		}
	});

	it('keeps letting go off a rock added today', () => {
		expect(offersRelease(asteroid({ driftAnchorAt: daysAgo(0) }), now)).toBe(false);
		expect(offersRelease(asteroid({ driftAnchorAt: daysAgo(7) }), now)).toBe(true);
	});

	it('travels from the inner edge to the outer one, then stops', () => {
		const at = (days: number) => driftFraction(asteroid({ driftAnchorAt: daysAgo(days) }), now);
		expect(at(0)).toBe(0);
		expect(at(21)).toBe(1);
		expect(at(365)).toBe(1);
		expect(at(10.5)).toBeCloseTo(0.5, 5);
	});

	it('says how long it has been out there without counting a debt', () => {
		const at = (days: number) => driftLabel(asteroid({ driftAnchorAt: daysAgo(days) }), now);
		expect(at(0)).toBe('Added today');
		expect(at(1)).toBe('Drifting a day');
		expect(at(9)).toBe('Drifting 9 days');
		expect(at(21)).toBe('Drifting 3 weeks');
	});

	it('has a short form for a row that has to share its line', () => {
		const at = (days: number) =>
			driftLabel(asteroid({ driftAnchorAt: daysAgo(days) }), now, 'short');
		expect(at(0)).toBe('Today');
		expect(at(1)).toBe('1 day');
		expect(at(9)).toBe('9 days');
		expect(at(21)).toBe('3 weeks');
	});
});

describe('doneLabel', () => {
	it('counts back from when it was finished, not from when it drifted', () => {
		const at = (days: number) => doneLabel({ resolvedAt: daysAgo(days) }, now);
		expect(at(0)).toBe('Done today');
		expect(at(1)).toBe('Done yesterday');
		expect(at(5)).toBe('Done 5 days ago');
		expect(at(21)).toBe('Done 3 weeks ago');
	});

	it('says only that it is done when nothing recorded when', () => {
		expect(doneLabel({ resolvedAt: null }, now)).toBe('Done');
	});

	it('keeps the fold bounded, so it cannot become a flattering ledger', () => {
		expect(DONE_VISIBLE).toBe(12);
	});
});

describe('sortBelt', () => {
	it('puts the oldest anchor first and leaves it at that', () => {
		const belt = [
			asteroid({ id: 'new', driftAnchorAt: daysAgo(1) }),
			asteroid({ id: 'old', driftAnchorAt: daysAgo(30) }),
			asteroid({ id: 'middling', driftAnchorAt: daysAgo(9) })
		];
		expect(sortBelt(belt).map((rock) => rock.id)).toEqual(['old', 'middling', 'new']);
	});

	it('leaves the list it was given alone', () => {
		const belt = [
			asteroid({ id: 'new', driftAnchorAt: daysAgo(1) }),
			asteroid({ id: 'old', driftAnchorAt: daysAgo(30) })
		];
		sortBelt(belt);
		expect(belt.map((rock) => rock.id)).toEqual(['new', 'old']);
	});
});

describe('isAsteroidResolution', () => {
	it('recognises the three terminal states and nothing else', () => {
		expect(isAsteroidResolution('cleared')).toBe(true);
		expect(isAsteroidResolution('captured')).toBe(true);
		expect(isAsteroidResolution('released')).toBe(true);
		expect(isAsteroidResolution('closed')).toBe(false);
		expect(isAsteroidResolution(null)).toBe(false);
	});
});
