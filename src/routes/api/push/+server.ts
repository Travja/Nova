import { deleteSubscription, saveSubscription } from '$lib/server/push/store';
import { remindersConfigured } from '$lib/server/push';
import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';

/**
 * Where a browser registers the device it wants reminders on.
 *
 * Form actions are the API everywhere in Nova that a person is filling
 * something in, and the reminders screen keeps them for the parts a person can
 * type. This is not one of those parts: a push subscription is minted by the
 * browser — an endpoint on somebody else's push service and two keys — and it
 * exists only after `pushManager.subscribe()` resolves, in JavaScript, with no
 * form anywhere near it. The same reason `/api/entries` exists.
 *
 * Nothing here is reachable signed out, and nothing trusts the body beyond its
 * shape: `saveSubscription()` writes the row under the session's own user id.
 */

/** Long enough for the longest push endpoint anybody ships, short enough to bound. */
const ENDPOINT_MAX = 1024;

const subscriptionSchema = z.object({
	/*
	 * https only. The sweep later POSTs to whatever endpoint is stored here, and
	 * every push service a browser can mint one against is https — so requiring
	 * it closes the one way a signed-in account could point the server at
	 * something on its own network.
	 */
	endpoint: z
		.string()
		.trim()
		.url()
		.max(ENDPOINT_MAX)
		.refine((value) => value.startsWith('https://'), 'A push endpoint must be https.'),
	keys: z.object({
		p256dh: z.string().trim().min(1).max(256),
		auth: z.string().trim().min(1).max(256)
	})
});

const unsubscribeSchema = z.object({
	endpoint: z.string().trim().min(1).max(ENDPOINT_MAX)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Sign in to turn reminders on.' }, { status: 401 });
	// An instance with no VAPID keys cannot send anything, so storing a
	// subscription against it would only collect devices nobody will ever reach.
	if (!remindersConfigured) {
		return json({ error: 'This Nova is not set up to send reminders.' }, { status: 503 });
	}

	const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return json({ error: 'Nova could not read that subscription.' }, { status: 400 });
	}

	await saveSubscription(locals.user.id, {
		endpoint: parsed.data.endpoint,
		p256dh: parsed.data.keys.p256dh,
		auth: parsed.data.keys.auth,
		// Names the device in the settings list, exactly as a session does.
		userAgent: request.headers.get('user-agent')
	});

	return json({ subscribed: true });
};

/**
 * Opting this device out.
 *
 * The browser unsubscribes too, and either half alone is not enough: dropping
 * the row without unsubscribing leaves the browser holding a subscription
 * nothing will ever push to, and unsubscribing without dropping the row leaves
 * Nova pushing at an endpoint that will start answering 410.
 */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Sign in first.' }, { status: 401 });

	const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return json({ error: 'Nova could not read that request.' }, { status: 400 });

	await deleteSubscription(locals.user.id, parsed.data.endpoint);
	return json({ subscribed: false });
};
