import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { listGoalSnapshots, logEntry, LOG_REFUSAL_MESSAGE } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	// The same instant snapshots the orbits and ranks them, so a goal cannot be
	// measured against one clock and sorted against another. It comes from the
	// request rather than from `new Date()` so a test can pin the hour — which
	// this view's meaning depends on, now that a satellite is only running out
	// of time in the last quarter of its day. See `$lib/server/clock`.
	const now = locals.now;
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
			note: form.get('note') ?? undefined,
			// Sent by the browser on every log, so a submission whose answer went
			// missing can be retried from the offline queue without double-counting.
			clientId: form.get('clientId') ?? undefined
		});

		if (!goalId) return fail(400, { errors: formError('Pick a goal to log against.') });
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const logged = await logEntry(locals.user.id, goalId, parsed.data);
		if (!logged.ok) {
			return fail(logged.reason === 'missing' ? 404 : 409, {
				errors: formError(LOG_REFUSAL_MESSAGE[logged.reason])
			});
		}

		return { logged: true };
	}
};
