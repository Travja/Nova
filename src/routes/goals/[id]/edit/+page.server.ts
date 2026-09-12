import { fieldErrors, goalSchema } from '$domain/validation';
import { getGoal, updateGoal } from '$lib/server/goals';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const goal = await getGoal(locals.user.id, params.id);
	if (!goal) error(404, 'That goal is not in orbit.');

	return { goal };
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = goalSchema.safeParse(Object.fromEntries(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		if (!(await updateGoal(locals.user.id, params.id, parsed.data))) {
			error(404, 'That goal is not in orbit.');
		}

		redirect(303, `/goals/${params.id}`);
	}
};
