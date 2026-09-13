import {
	celebrationShape,
	isFreshClosing,
	type CelebrationShape,
	type OrbitMark
} from '$domain/celebration';
import type { GoalSnapshot } from '$domain/progress';
import type { Tier } from '$domain/tiers';

/**
 * The browser's memory of which orbits were open when it last looked.
 *
 * Logging is a form action, so every log re-renders the whole page and a
 * component cannot tell a closing from a redraw on its own. The pages hand
 * their snapshots to `noteOrbits` from an effect — which never runs on the
 * server — and anything that wants to react reads `celebrationFor`.
 *
 * One entry per goal, replaced on every look, so this cannot grow with how
 * long a tab has been open. Deliberately a plain object rather than reactive
 * state: an effect that depended on what it writes would never settle.
 */
const seen: Record<string, OrbitMark> = {};

export interface Celebration {
	goalId: string;
	title: string;
	tier: Tier;
	shape: CelebrationShape;
	/** Tells one closing from the next, so a repeat restarts the animation. */
	stamp: number;
}

let current = $state<Celebration | null>(null);
let clearing: ReturnType<typeof setTimeout> | undefined;
let stamps = 0;

/**
 * Record what each goal's orbit looks like now, and raise a celebration for any
 * that closed since the last look.
 *
 * Several can close at once — a backdated entry, or two quick logs — and the
 * newest wins, because a second burst on top of the first is noise.
 */
export function noteOrbits(snapshots: readonly GoalSnapshot[]): void {
	for (const snapshot of snapshots) {
		const mark: OrbitMark = {
			key: snapshot.current.period.key,
			complete: snapshot.current.complete,
			dormant: snapshot.current.dormant
		};
		const previous = seen[snapshot.goal.id];
		seen[snapshot.goal.id] = mark;
		if (!isFreshClosing(previous, mark)) continue;

		const shape = celebrationShape(snapshot.goal.tier);
		stamps += 1;
		current = {
			goalId: snapshot.goal.id,
			title: snapshot.goal.title,
			tier: snapshot.goal.tier,
			shape,
			stamp: stamps
		};

		clearTimeout(clearing);
		// Long enough for the animation to finish, and then gone: nothing about a
		// closing should still be on screen when the next page is.
		clearing = setTimeout(() => (current = null), shape.ms + 120);
	}
}

/** The closing being celebrated right now, if any. */
export function celebration(): Celebration | null {
	return current;
}

/** The closing being celebrated for one goal, if it is that goal's turn. */
export function celebrationFor(goalId: string): Celebration | null {
	return current?.goalId === goalId ? current : null;
}
