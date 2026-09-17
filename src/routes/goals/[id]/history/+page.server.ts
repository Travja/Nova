import { getGoalHistoryPage } from '$lib/server/goals';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const requested = Number(url.searchParams.get('page') ?? '0');
	const history = await getGoalHistoryPage(
		locals.user,
		params.id,
		locals.now,
		Number.isInteger(requested) ? requested : 0
	);
	if (!history) error(404, 'That goal is not in orbit.');

	return { ...history, timeZone: locals.user.timeZone };
};
