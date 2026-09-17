import { formatMinuteOfDay, parseMinuteOfDay } from '$domain/reminders';
import { formError, type FormErrors } from '$domain/validation';
import { remindersConfigured, sendTestReminder, vapidPublicKey } from '$lib/server/push';
import {
	deleteDevice,
	listDevices,
	readReminderSettings,
	writeReminderSettings
} from '$lib/server/push/store';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * The opt-in, and the terms it comes with.
 *
 * Everything a person types here is an ordinary form action, so the switch and
 * the quiet hours work with no JavaScript at all. The one thing that cannot be
 * is the subscription itself, which the browser mints — that goes to
 * `/api/push`, and the page explains as much when scripting is off.
 */

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const settings = await readReminderSettings(locals.user.id);
	return {
		/** False when this instance has no VAPID keys, which is the default. */
		configured: remindersConfigured,
		/** Public by design — it is what a browser subscribes against. */
		publicKey: vapidPublicKey,
		reminders: {
			enabled: settings.enabled,
			// As a `time` input wants them, in the account's own wall clock.
			quietFrom: formatMinuteOfDay(settings.quiet.from),
			quietUntil: formatMinuteOfDay(settings.quiet.until),
			lastSentAt: settings.lastSentAt
		},
		devices: await listDevices(locals.user.id),
		timeZone: locals.user.timeZone
	};
};

export const actions: Actions = {
	/** The switch and the quiet window, saved together. */
	save: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const from = parseMinuteOfDay(String(form.get('quietFrom') ?? ''));
		const until = parseMinuteOfDay(String(form.get('quietUntil') ?? ''));

		if (from === null || until === null) {
			const errors: FormErrors = { quietFrom: 'Give both quiet hours as a time of day.' };
			return fail(400, { errors });
		}

		await writeReminderSettings(locals.user.id, {
			enabled: form.get('enabled') === 'on',
			quiet: { from, until }
		});
		return { saved: true };
	},

	/**
	 * Send one now.
	 *
	 * Opting in is two separate things — this account's terms, and this device's
	 * subscription — and only a notification that actually arrives proves the
	 * second one worked.
	 */
	test: async ({ locals }) => {
		if (!locals.user) redirect(303, '/login');
		if (!remindersConfigured) {
			return fail(503, { errors: formError('This Nova is not set up to send reminders.') });
		}

		const result = await sendTestReminder(locals.user);
		if (result.sent === 0) {
			return fail(409, {
				errors: formError(
					'Nothing took delivery. Turn reminders on for this device first, or try again after allowing notifications.'
				)
			});
		}
		return { tested: result.sent };
	},

	/** Forget a device from the list — the route for one you no longer have. */
	forget: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!(await deleteDevice(locals.user.id, id))) {
			return fail(404, { errors: formError('That device is already gone.') });
		}
		return { forgot: true };
	}
};
