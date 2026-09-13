import { periodFor, periodLabel, toLocalDateTime } from '$domain/period';
import { cadenceOf } from '$domain/tiers';
import { entrySchemaFor, fieldErrors, formError, occurredAtBounds } from '$domain/validation';
import {
	deleteEntry,
	deleteGoal,
	getGoal,
	getGoalDetail,
	logEntry,
	orbitAt,
	setGoalArchived,
	updateEntry
} from '$lib/server/goals';
import type { SessionUser } from '$lib/server/auth/session';
import type { Goal } from '$domain/types';
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function periodOptions(user: SessionUser) {
	return { timeZone: user.timeZone, weekStartsOn: user.weekStartsOn };
}

/**
 * Where an entry landed, so the screen can say which orbit moved. Logging into
 * a period that has already ended leaves the one in flight untouched, and that
 * is exactly the surprise worth naming.
 */
async function orbitReport(user: SessionUser, goal: Goal, occurredAt: Date, now: Date) {
	const at = await orbitAt(user, goal.id, occurredAt);
	if (!at) return null;

	const currentKey = periodFor(now, cadenceOf(goal.tier), periodOptions(user)).key;
	return {
		label: periodLabel(at.period, user.timeZone),
		current: at.period.key === currentKey,
		closed: at.orbit.complete,
		logged: at.orbit.logged,
		target: at.orbit.target
	};
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const detail = await getGoalDetail(locals.user, params.id);
	if (!detail) error(404, 'That goal is not in orbit.');

	const now = new Date();
	const bounds = occurredAtBounds(detail.snapshot.goal, periodOptions(locals.user), now);

	return {
		...detail,
		/** Which entry the list is editing, driven by the URL so it works without JS. */
		editing: url.searchParams.get('edit'),
		/** Archiving asks first, and the question lives in the URL for the same reason. */
		confirmingArchive: url.searchParams.get('confirm') === 'archive',
		timeZone: locals.user.timeZone,
		/** `datetime-local` bounds and default, already in the user's own zone. */
		occurredAt: {
			now: toLocalDateTime(now, locals.user.timeZone),
			min: toLocalDateTime(bounds.earliest, locals.user.timeZone),
			max: toLocalDateTime(bounds.latest, locals.user.timeZone)
		}
	};
};

export const actions: Actions = {
	log: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const goal = await getGoal(locals.user.id, params.id);
		if (!goal) error(404, 'That goal is not in orbit.');

		const now = new Date();
		const form = await request.formData();
		const parsed = entrySchemaFor(
			occurredAtBounds(goal, periodOptions(locals.user), now)
		).safeParse({
			amount: form.get('amount'),
			note: form.get('note') ?? undefined,
			occurredAt: form.get('occurredAt') ?? undefined
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const entry = await logEntry(locals.user.id, params.id, parsed.data);
		if (!entry) {
			return fail(409, {
				errors: formError('This goal is archived. Restore it before logging against it.')
			});
		}

		return { logged: true, orbit: await orbitReport(locals.user, goal, entry.occurredAt, now) };
	},

	editEntry: async ({ request, locals, params }) => {
		if (!locals.user) redirect(303, '/login');

		const goal = await getGoal(locals.user.id, params.id);
		if (!goal) error(404, 'That goal is not in orbit.');

		const now = new Date();
		const form = await request.formData();
		const entryId = String(form.get('entryId') ?? '');
		const parsed = entrySchemaFor(
			occurredAtBounds(goal, periodOptions(locals.user), now)
		).safeParse({
			amount: form.get('amount'),
			note: form.get('note') ?? undefined,
			occurredAt: form.get('occurredAt') ?? undefined
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const entry = await updateEntry(locals.user.id, params.id, entryId, parsed.data);
		if (!entry) return fail(404, { errors: formError('That entry is no longer here.') });

		return { edited: true, orbit: await orbitReport(locals.user, goal, entry.occurredAt, now) };
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
		if (archived) redirect(303, '/goals/archived');
		return { archived };
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		await deleteGoal(locals.user.id, params.id);
		redirect(303, '/');
	}
};
