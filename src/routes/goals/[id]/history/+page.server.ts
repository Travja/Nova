import { fieldErrors, formError, orbitNoteSchema } from '$domain/validation';
import { getGoalHistoryPage } from '$lib/server/goals';
import { deleteOrbitNote, writeOrbitNote } from '$lib/server/orbit-notes';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const requested = Number(url.searchParams.get('page') ?? '0');
	const history = await getGoalHistoryPage(
		locals.user,
		params.id,
		locals.now,
		Number.isInteger(requested) ? requested : 0
	);
	if (!history) error(404, 'That goal is not in orbit.');

	return {
		...history,
		timeZone: locals.user.timeZone,
		/** Which period's note is open for editing, driven by the URL so a row
		 *  survives a submit without JavaScript. */
		editingNote: url.searchParams.get('note')
	};
};

export const actions: Actions = {
	/**
	 * Write or edit a note. The same action handles clearing one too: a
	 * trimmed-empty body is never stored, so a pilot who deletes the text and
	 * hits Save gets the same outcome as the dedicated Clear control below.
	 */
	note: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = orbitNoteSchema.safeParse({
			periodKey: form.get('periodKey'),
			periodStart: form.get('periodStart'),
			body: form.get('body') ?? ''
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const result = await writeOrbitNote(locals.user.id, params.id, parsed.data);
		if (!result.ok) return fail(404, { errors: formError('That goal is no longer in orbit.') });

		return { noteSaved: true };
	},

	clearNote: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const periodKey = String(form.get('periodKey') ?? '');
		await deleteOrbitNote(locals.user.id, params.id, periodKey);

		return { noteSaved: true };
	}
};
