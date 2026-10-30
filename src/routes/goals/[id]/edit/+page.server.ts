import { fieldErrors, goalSchema } from '$domain/validation';
import {
	childRestDayCapacity,
	getGoal,
	getGoalSchedule,
	listGoals,
	updateGoal
} from '$lib/server/goals';
import { latestSchedule } from '$domain/schedule';
import { goalFormInput, goalWriteErrors } from '$lib/server/goal-form';
import { childrenOf, restDayWarning } from '$domain/nesting';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const goal = await getGoal(locals.user.id, params.id);
	if (!goal) error(404, 'That goal is not in orbit.');

	const goals = await listGoals(locals.user.id);
	const children = childrenOf(goal.id, goals);
	const capacity =
		children.length > 0 ? await childRestDayCapacity(locals.user, goal.id, locals.now) : null;

	return {
		goal,
		goals,
		children,
		// The form shows the schedule the goal flies from here on, pending edits included.
		restDays: latestSchedule((await getGoalSchedule(locals.user.id, goal.id)) ?? [])?.restDays ?? 0,
		weekStartsOn: locals.user.weekStartsOn,
		restDayWarning: restDayWarning(goal, capacity)
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = goalSchema.safeParse(goalFormInput(form));
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const updated = await updateGoal(locals.user.id, params.id, parsed.data, {
			timeZone: locals.user.timeZone,
			weekStartsOn: locals.user.weekStartsOn
		});
		if (!updated.ok) {
			if (updated.missing) error(404, 'That goal is not in orbit.');
			return fail(400, { errors: goalWriteErrors(updated) });
		}

		redirect(303, `/goals/${params.id}`);
	}
};
