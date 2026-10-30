import { formError } from '$domain/validation';
import { listHangar, setGoalArchived } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * The hangar: every goal that is not flying (#67). Finished goals have landed
 * and keep their record; archived ones are parked and can be restored. The
 * route keeps the path it had when it held only the second kind, so nothing
 * that links here breaks.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return { ...(await listHangar(locals.user, locals.now)), timeZone: locals.user.timeZone };
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
