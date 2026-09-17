import { asteroidSchema, entrySchema, fieldErrors, formError } from '$domain/validation';
import {
	clearAsteroid,
	createAsteroid,
	dismissCaptureOffer,
	listAsteroids,
	listDoneAsteroids,
	releaseAsteroid,
	updateAsteroidNote,
	updateAsteroidTitle
} from '$lib/server/asteroids';
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
		// The belt is loaded beside the orbits and drawn below them. It has no
		// snapshot of its own: an asteroid has no period to close, so there is
		// nothing here for the orbit maths to compute.
		asteroids: await listAsteroids(locals.user.id),
		// What has settled back into the belt, so the band says what was got
		// through and not only what is still out there.
		doneAsteroids: await listDoneAsteroids(locals.user.id),
		now
	};
};

const GONE = 'That one has already left the belt.';

/** The id every belt action takes, straight off the form. */
function asteroidId(form: FormData): string {
	return String(form.get('id') ?? '');
}

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
	},

	/** A one-off onto the belt: a title, and nothing else to decide. */
	addAsteroid: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const parsed = asteroidSchema.safeParse({
			title: form.get('title'),
			note: form.get('note') ?? undefined
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		await createAsteroid(locals.user.id, parsed.data);
		return { belt: 'On the belt.' };
	},

	/**
	 * Done. The answer carries the capture offer for the title just finished, so
	 * the belt can ask whether it should be a goal in the same breath as saying
	 * it is done — inline, where somebody is already looking, rather than as a
	 * banner that turns up later uninvited.
	 *
	 * `cleared` stays the stored name of the state: the three terminal states
	 * are settled vocabulary that #17's export is scoped against. "Done" is
	 * what a person reads, which is a different question.
	 */
	clearAsteroid: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const cleared = await clearAsteroid(locals.user.id, asteroidId(form));
		if (!cleared.ok) return fail(404, { errors: formError(GONE) });

		return {
			belt: 'Done.',
			offer: cleared.offer.offer
				? {
						asteroidId: cleared.asteroid.id,
						title: cleared.asteroid.title,
						count: cleared.offer.count
					}
				: null
		};
	},

	/** Let go, on purpose. The same weight as clearing, and never a verdict. */
	releaseAsteroid: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const released = await releaseAsteroid(locals.user.id, asteroidId(form));
		if (!released.ok) return fail(404, { errors: formError(GONE) });

		return { belt: 'Released.' };
	},

	/**
	 * Rewrite the title, amend the note, or both.
	 *
	 * Two service calls rather than one, because they mean different things to
	 * the drift clock: the title moves it and the note does not. The title goes
	 * last so the anchor, when it moves, lands after the save rather than before
	 * it.
	 */
	editAsteroid: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const id = asteroidId(form);
		const parsed = asteroidSchema.safeParse({
			title: form.get('title'),
			note: form.get('note') ?? undefined
		});
		if (!parsed.success) return fail(400, { errors: fieldErrors(parsed.error) });

		const noted = await updateAsteroidNote(locals.user.id, id, parsed.data.note);
		if (!noted.ok) return fail(404, { errors: formError(GONE) });

		const retitled = await updateAsteroidTitle(locals.user.id, id, parsed.data.title);
		if (!retitled.ok) return fail(404, { errors: formError(GONE) });

		return { belt: 'Saved.' };
	},

	/** "No, this one really is a one-off." Not asked again until the count resets. */
	dismissCapture: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const dismissed = await dismissCaptureOffer(locals.user.id, asteroidId(form));
		if (!dismissed.ok) return fail(404, { errors: formError(GONE) });

		return { belt: 'Left as a one-off.' };
	}
};
