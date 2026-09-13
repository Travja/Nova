import { isTier } from '$domain/tiers';
import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { listGoalSnapshots, logEntry, moveGoal, reorderGoals } from '$lib/server/goals';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) return { snapshots: null, reordering: false };
	return {
		snapshots: await listGoalSnapshots(locals.user),
		/** Reorder mode lives in the URL, so it survives a submit without JavaScript. */
		reordering: url.searchParams.get('reorder') === '1'
	};
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
	},

	/** One step up or down within a tier — the keyboard and no-JavaScript route. */
	move: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const goalId = String(form.get('goalId') ?? '');
		const delta = form.get('direction') === 'up' ? -1 : 1;

		if (!(await moveGoal(locals.user.id, goalId, delta))) {
			return fail(400, { errors: formError('That goal is already at the end of its tier.') });
		}
		return { moved: String(form.get('title') ?? 'Goal') };
	},

	/** A whole tier's order at once, which is what a drag sends. */
	reorder: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const tier = form.get('tier');
		const orderedIds = String(form.get('order') ?? '')
			.split(',')
			.filter(Boolean);

		if (!isTier(tier)) return fail(400, { errors: formError('That tier is not in the sky.') });
		if (!(await reorderGoals(locals.user.id, tier, orderedIds))) {
			return fail(409, { errors: formError('That order no longer matches your goals.') });
		}
		return { reordered: true };
	}
};
