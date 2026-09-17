import { resolve } from '$app/paths';
import { fieldErrors, goalSchema } from '$domain/validation';
import { captureAsteroid, getAsteroid } from '$lib/server/asteroids';
import { createGoal, listGoals } from '$lib/server/goals';
import { goalWriteErrors } from '$lib/server/goal-form';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * `?asteroid=<id>` turns this screen into the capture from #30.
 *
 * The same form either way, deliberately: a captured goal has to be
 * indistinguishable from one created directly, and the surest way to get that
 * is for it to be created by the same screen and the same service call.
 */
const ASTEROID = 'asteroid';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const id = url.searchParams.get(ASTEROID);
	const asteroid = id ? await getAsteroid(locals.user.id, id) : null;
	// An id that names nothing this user owns — or a rock that has already been
	// captured or released — would leave the page claiming a capture the action
	// is going to refuse. Drop the parameter and launch an ordinary goal.
	if (id && (!asteroid || (asteroid.resolution && asteroid.resolution !== 'cleared'))) {
		redirect(303, resolve('/goals/new'));
	}

	return {
		// Every live goal, so the picker can narrow itself as the tier changes
		// without a round trip. The rules it filters by are the ones the write path
		// enforces — `eligibleParents` is the same function on both sides.
		goals: await listGoals(locals.user.id),
		asteroid: asteroid ? { id: asteroid.id, title: asteroid.title, note: asteroid.note } : null
	};
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = goalSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const id = url.searchParams.get(ASTEROID);
		// `captureAsteroid` delegates to `createGoal`, so the nesting and tier
		// rules are checked once, in the one place that knows them.
		const created = id
			? await captureAsteroid(locals.user.id, id, parsed.data)
			: await createGoal(locals.user.id, parsed.data);
		if (!created.ok) return fail(400, { errors: goalWriteErrors(created) });

		redirect(303, `/goals/${created.goal.id}`);
	}
};
