import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { listGoalSnapshots, logEntry } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	// The same instant snapshots the orbits and ranks them, so a goal cannot be
	// measured against one clock and sorted against another.
	const now = new Date();
	return {
		snapshots: await listGoalSnapshots(locals.user, now),
		now
	};
};

export const actions: Actions = {
	/** Quick-log from a row, without leaving the view. */
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
