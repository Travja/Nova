import { formError } from '$domain/validation';
import { listArchivedSnapshots, setGoalArchived } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return { snapshots: await listArchivedSnapshots(locals.user) };
};

export const actions: Actions = {
	restore: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const goalId = String(form.get('goalId') ?? '');
		const title = String(form.get('title') ?? 'That goal');

		if (!(await setGoalArchived(locals.user.id, goalId, false))) {
			return fail(404, { errors: formError('That goal is already back in orbit.') });
		}
		return { restored: title };
	}
};
