import { bundleFilename, exportBundle, serializeBundle } from '$lib/server/transfer/export';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * The export, as a download.
 *
 * A plain `GET` behind a link rather than a form action, so it works with no
 * JavaScript and so "save the file somewhere" is the browser's job rather than
 * something this app reimplements. Nothing here is cacheable: it is one
 * account's whole record, and an intermediary holding a copy of it is exactly
 * the thing the allowlist in `$lib/server/transfer/export` exists to limit.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const exportedAt = new Date();
	const bundle = await exportBundle(locals.user.id, exportedAt);
	// Only reachable if the account was deleted between the session check and
	// here, which is a thing a second tab can do.
	if (!bundle) error(404, 'That account is gone.');

	return new Response(serializeBundle(bundle), {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="${bundleFilename(exportedAt)}"`,
			'cache-control': 'no-store, private'
		}
	});
};
