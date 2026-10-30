import { reviewYears, yearReview } from '$domain/review';
import { clearedAsteroidTimes } from '$lib/server/asteroids';
import { loadReviewInputs } from '$lib/server/goals';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** A calendar year Nova could plausibly hold — anything else is not a page. */
const YEAR = /^(19[7-9]\d|2\d{3})$/;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	if (!YEAR.test(params.year)) error(404, 'That is not a year Nova can look back on.');

	const year = Number(params.year);
	const now = locals.now;
	const options = { timeZone: locals.user.timeZone, weekStartsOn: locals.user.weekStartsOn };

	const [sources, clearedAsteroids] = await Promise.all([
		loadReviewInputs(locals.user, now),
		clearedAsteroidTimes(locals.user.id)
	]);

	return {
		// Worked out here so the page carries the year, not every goal's whole
		// lifetime of orbits. Nothing on it leaves the server another way: no
		// share image, no public link (#68).
		review: yearReview({ ...sources, clearedAsteroids }, year, options, now),
		years: reviewYears(sources.firstLaunch, now, locals.user.timeZone),
		now
	};
};
