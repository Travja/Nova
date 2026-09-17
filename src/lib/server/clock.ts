import { fromZonedParts, parseLocalDateTime, zonedParts } from '$domain/period';

/**
 * The server's clock, and the one seam that can move it.
 *
 * Nova is correctly time-dependent: whether an orbit is running out of time
 * depends on the hour, and after #48 a satellite is only closing in the last
 * quarter of its day. That makes `new Date()` inside a load function untestable
 * — the Today view passed at every hour by accident, and a reminder that is
 * supposed to fire late in the evening has no way to say so from a test.
 *
 * So every request carries its own instant, `locals.now`, and in development
 * only, a cookie may pin it. `hooks.server.ts` is where that gate lives: it
 * reads `dev` from `$app/environment`, which Vite replaces with a literal
 * `false` in a production build, so the call below is dead code that never
 * ships. Nothing here reads the environment either, so a production instance
 * cannot have its clock moved by a request or by a variable — the code that
 * would do it is not in the bundle.
 *
 * This module holds no SvelteKit import of its own, which keeps the parsing
 * testable on its own terms.
 */

/** The cookie the end-to-end tests pin the clock with. Development only. */
export const CLOCK_COOKIE = 'nova_clock';

/** `21:00` — a wall-clock time, meaning today at that hour in the user's zone. */
const TIME_ONLY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Read a pinned clock, or null when there is nothing valid to read.
 *
 * Two shapes, and the difference between them matters to whoever is writing
 * the test:
 *
 * - `21:00` moves the hour and keeps today's date, so every period in flight is
 *   still the one the real clock is in. Anything written under it is stamped by
 *   the ordinary clock — `logEntry()` and the rest are untouched by any of this
 *   — and still lands in the period being displayed. This is the shape to use
 *   whenever a test logs something.
 * - `2026-10-01T21:00` moves the date as well, which is how a test reaches a
 *   week or a year that is nowhere near its deadline. Writes then land in the
 *   real period rather than the displayed one, so use it only to read.
 *
 * Both are wall-clock times in the user's own zone, never UTC, because every
 * boundary this feeds is computed in that zone too.
 */
export function clockOverride(
	raw: string | null | undefined,
	timeZone: string,
	now: Date = new Date()
): Date | null {
	const value = raw?.trim();
	if (!value) return null;

	const time = TIME_ONLY.exec(value);
	if (!time) return parseLocalDateTime(value, timeZone);

	const parts = zonedParts(now, timeZone);
	return fromZonedParts(
		{ ...parts, hour: Number(time[1]), minute: Number(time[2]), second: 0 },
		timeZone
	);
}
