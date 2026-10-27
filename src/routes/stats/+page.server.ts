import { reviewYears } from '$domain/review';
import { listGoals, loadStatsInputs } from '$lib/server/goals';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	// One instant for every number on the page, so "decided" and "in flight"
	// agree with each other everywhere they are asked.
	const now = locals.now;

	// The year in review (#68) is reached from here outside its season. Archived
	// goals count toward which years there are: they flew in them.
	const everyGoal = await listGoals(locals.user.id, true);
	const firstLaunch = everyGoal.reduce<Date | null>(
		(earliest, goal) => (!earliest || goal.createdAt < earliest ? goal.createdAt : earliest),
		null
	);

	return {
		...(await loadStatsInputs(locals.user, now)),
		reviewYears: reviewYears(firstLaunch, now, locals.user.timeZone),
		now
	};
};
