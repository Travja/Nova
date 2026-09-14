import { fieldErrors, goalSchema } from '$domain/validation';
import { createGoal, listGoals } from '$lib/server/goals';
import { goalWriteErrors } from '$lib/server/goal-form';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	// Every live goal, so the picker can narrow itself as the tier changes
	// without a round trip. The rules it filters by are the ones the write path
	// enforces — `eligibleParents` is the same function on both sides.
	return { goals: await listGoals(locals.user.id) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = goalSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const created = await createGoal(locals.user.id, parsed.data);
		if (!created.ok) return fail(400, { errors: goalWriteErrors(created) });

		redirect(303, `/goals/${created.goal.id}`);
	}
};
