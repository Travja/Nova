import { deserialize } from '$app/forms';
import type { ActionResult } from '@sveltejs/kit';

/**
 * The browser half of a passkey ceremony's round trips (#69).
 *
 * A ceremony is two posts with the authenticator in between, so it cannot be
 * one `<form>`. Both posts still go to ordinary form actions — form actions
 * stay the API — and come back as the same `ActionResult` `enhance` would see,
 * so `applyAction()` can finish the job: a redirect navigates, a failure lands
 * in the page's `form` prop like any other.
 *
 * All the WebAuthn itself is `@simplewebauthn/browser`'s; this only carries it.
 */

/**
 * The URL of a named action on the current page, keeping the query string —
 * the login page's `?next=` must survive a passkey sign-in as it survives a
 * password one. Any action already in the query, left by a post without
 * JavaScript, is dropped so there is only ever one.
 */
export function actionUrl(action: string, current: URL): string {
	const params = [...current.searchParams].filter(([key]) => !key.startsWith('/'));
	const rest = new URLSearchParams(params).toString();
	return `${current.pathname}?/${action}${rest ? `&${rest}` : ''}`;
}

export async function postAction(
	action: string,
	fields: Record<string, string> = {}
): Promise<ActionResult> {
	const body = new FormData();
	for (const [name, value] of Object.entries(fields)) body.set(name, value);

	const response = await fetch(actionUrl(action, new URL(location.href)), {
		method: 'POST',
		body,
		headers: { 'x-sveltekit-action': 'true' }
	});
	return deserialize(await response.text());
}
