import { fieldErrors, goalSchema } from '$domain/validation';
import { getGoal, listGoals, updateGoal } from '$lib/server/goals';
import { goalWriteErrors } from '$lib/server/goal-form';
import { childrenOf } from '$domain/nesting';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const goal = await getGoal(locals.user.id, params.id);
	if (!goal) error(404, 'That goal is not in orbit.');

	const goals = await listGoals(locals.user.id);
	return { goal, goals, children: childrenOf(goal.id, goals) };
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = goalSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const updated = await updateGoal(locals.user.id, params.id, parsed.data);
		if (!updated.ok) {
			if (updated.missing) error(404, 'That goal is not in orbit.');
			return fail(400, { errors: goalWriteErrors(updated) });
		}

		redirect(303, `/goals/${params.id}`);
	}
};
