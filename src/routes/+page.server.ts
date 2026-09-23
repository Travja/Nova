import { isTier } from '$domain/tiers';
import { entrySchema, fieldErrors, formError } from '$domain/validation';
import { mergePreferences } from '$domain/preferences';
import { listAsteroids } from '$lib/server/asteroids';
import {
	listGoalSnapshots,
	logEntry,
	moveGoal,
	reorderGoals,
	LOG_REFUSAL_MESSAGE
} from '$lib/server/goals';
import { updateProfile } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) return { snapshots: null, reordering: false, asteroids: [] };

	// The universe view draws the belt round the home star; the tiered grid
	// never touches an asteroid, so there is nothing to load for it here.
	const universe = locals.user.preferences.dashboard === 'universe';

	return {
		snapshots: await listGoalSnapshots(locals.user, locals.now),
		/** Reorder mode lives in the URL, so it survives a submit without JavaScript. */
		reordering: url.searchParams.get('reorder') === '1',
		asteroids: universe ? await listAsteroids(locals.user.id) : []
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
	},

	/**
	 * The Tiers | Universe toggle (#11, decision 14): two submit buttons named
	 * `view`, merged into the `dashboard` preference exactly as the settings
	 * form saves any other one. `use:enhance`'s default behaviour re-runs the
	 * load function, so the server renders whichever view is now stored; without
	 * JavaScript, SvelteKit renders this same request's response straight from
	 * this action rather than issuing a fresh GET — `locals.user` is updated in
	 * place so that render, and this request's own `load`, see the new value
	 * rather than the one `hooks.server.ts` read before the action ran.
	 */
	view: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const preferences = mergePreferences(locals.user.preferences, { dashboard: form.get('view') });
		await updateProfile(locals.user.id, { preferences });
		locals.user = { ...locals.user, preferences };
		return { ok: true };
	}
};
