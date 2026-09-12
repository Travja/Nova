import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { listGoalSnapshots, logEntry } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return { snapshots: null };
	return { snapshots: await listGoalSnapshots(locals.user) };
};

export const actions: Actions = {
	/** Quick-log from a goal card. */
	log: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const goalId = String(form.get('goalId') ?? '');
		const parsed = entrySchema.safeParse({
			amount: form.get('amount'),
			note: form.get('note') ?? undefined
		});

		if (!goalId) return fail(400, { errors: formError('Pick a goal to log against.') });
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const entry = await logEntry(locals.user.id, goalId, parsed.data);
		if (!entry) return fail(404, { errors: formError('That goal is no longer in orbit.') });

		return { logged: true };
	}
};
