import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { listGoals, logEntry } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}

	return {
		goals: await listGoals(locals.user.id),
		// The share sheet sends whichever of these the source app filled in;
		// text carries the note where there is one, title otherwise.
		sharedText: url.searchParams.get('text') || url.searchParams.get('title') || ''
	};
};

export const actions: Actions = {
	/** Log the shared note against whichever goal the user picked. */
	log: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const goalId = String(form.get('goalId') ?? '');
		const parsed = entrySchema.safeParse({
			amount: form.get('amount'),
			note: form.get('note') ?? undefined,
			// Sent by the browser on every log, so a submission whose answer went
			// missing can be retried from the offline queue without double-counting.
			clientId: form.get('clientId') ?? undefined
		});

		if (!goalId) return fail(400, { errors: formError('Pick a goal to log against.') });
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const entry = await logEntry(locals.user.id, goalId, parsed.data);
		if (!entry) return fail(404, { errors: formError('That goal is no longer in orbit.') });

		return { logged: true };
	}
};
