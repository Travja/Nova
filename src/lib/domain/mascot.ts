import type { FocusRow, GoalSnapshot, TodayFocus } from './progress';

/**
 * What the pilot is doing out there, read off the same split the focused view
 * is built from.
 *
 * The mascot is the emotional read of the whole app, so it has to be honest:
 * every mood here comes from the orbits themselves, and the one that decides it
 * is named, so the drawing can point at it. Nothing here is a scold — a missed
 * orbit is information.
 */
export type Mood =
	/** Nothing is owed: everything that could close has closed. */
	| 'resting'
	/** In flight and on pace — busy, and not behind. */
	| 'working'
	/** Something needs attention while there is still time to give it. */
	| 'alert'
	/** A period is nearly over and well short of its target. */
	| 'adrift';

export interface MascotState {
	mood: Mood;
	/** The orbit that decided the mood, for the mascot to point at. */
	subject: GoalSnapshot | null;
	atRisk: number;
	closed: number;
	steady: number;
}

/**
 * How much of a target must still be missing, with the period closing, before
 * catching up stops being the likely outcome. Half: below that, the mascot is
 * pointing rather than drifting, because there is still a day worth having.
 */
export const ADRIFT_SHORTFALL = 0.5;

/** The mood the whole picture adds up to. */
export function mascotFor(focus: TodayFocus): MascotState {
	const counts = {
		atRisk: focus.atRisk.length,
		closed: focus.closed.length,
		steady: focus.steady.length
	};

	const [urgent] = focus.atRisk;
	if (urgent)
		return { mood: isAdrift(urgent) ? 'adrift' : 'alert', subject: urgent.snapshot, ...counts };

	// Nothing needs attention. Still flying is work; everything closed is rest.
	const [next] = focus.steady;
	if (next) return { mood: 'working', subject: next.snapshot, ...counts };
	return { mood: 'resting', subject: focus.closed[0] ?? null, ...counts };
}

/** Out of time and well short of target, rather than merely behind. */
function isAdrift(row: FocusRow): boolean {
	return row.closing && row.snapshot.current.fraction < ADRIFT_SHORTFALL;
}
