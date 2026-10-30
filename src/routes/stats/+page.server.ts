import { reviewYears } from '$domain/review';
import { firstLaunch, loadStatsInputs } from '$lib/server/goals';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	// One instant for every number on the page, so "decided" and "in flight"
	// agree with each other everywhere they are asked.
	const now = locals.now;

	return {
		...(await loadStatsInputs(locals.user, now)),
		// The year in review (#68) is reached from here outside its season.
		// `firstLaunch` counts archived and finished goals too: they flew.
		reviewYears: reviewYears(await firstLaunch(locals.user.id), now, locals.user.timeZone),
		now
	};
};
