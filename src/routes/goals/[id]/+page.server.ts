import { entrySchema, fieldErrors, formError } from '$domain/validation';
import {
	deleteEntry,
	deleteGoal,
	getGoalDetail,
	logEntry,
	setGoalArchived
} from '$lib/server/goals';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const detail = await getGoalDetail(locals.user, params.id);
	if (!detail) error(404, 'That goal is not in orbit.');

	return detail;
};

export const actions: Actions = {
	log: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = entrySchema.safeParse({
			amount: form.get('amount'),
			note: form.get('note') ?? undefined,
			occurredAt: form.get('occurredAt') || undefined
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const entry = await logEntry(locals.user.id, params.id, parsed.data);
		if (!entry) error(404, 'That goal is not in orbit.');

		return { logged: true };
	},

	deleteEntry: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const entryId = String(form.get('entryId') ?? '');
		if (!(await deleteEntry(locals.user.id, entryId))) {
			return fail(404, { errors: formError('That entry is already gone.') });
		}
		return { removed: true };
	},

	archive: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const archived = form.get('archived') !== 'false';
		await setGoalArchived(locals.user.id, params.id, archived);
		if (archived) redirect(303, '/');
		return { archived };
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		await deleteGoal(locals.user.id, params.id);
		redirect(303, '/');
	}
};
