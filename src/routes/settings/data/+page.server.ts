import {
	importProblemMessage,
	MAX_BUNDLE_BYTES,
	MAX_BUNDLE_LABEL,
	type ImportMode,
	type ImportSummary
} from '$domain/transfer';
import { formError, type FormErrors } from '$domain/validation';
import { clearSessionCookie } from '$lib/server/auth/session';
import { applyImport, loadAccountShape, previewImport } from '$lib/server/transfer/import';
import { dropStaged, dropStagedFor, readStaged, stageBundle } from '$lib/server/transfer/staging';
import { deleteAccount } from '$lib/server/users';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Export, import and delete — #17.
 *
 * Importing is two posts. The first reads the file, plans the write and shows
 * what it would do; the second confirms it. Between them the file sits in
 * `$lib/server/transfer/staging` under a token, so the confirming post is an
 * ordinary form with no JavaScript in it and no second upload.
 *
 * The plan the summary is rendered from and the plan that is written are the
 * same call — `applyImport()` is `previewImport()` plus a transaction — so
 * what is on screen describes the write that is about to happen rather than
 * one like it.
 *
 * Deleting the account lives here too, but it is the one action on this screen
 * that touches the account rather than its goals: an import moves goals, and
 * the file it reads has no account in it to restore.
 *
 * Nothing in this file builds a query or decides what a row becomes. The
 * services do, and they re-check ownership while they do it.
 */

function modeFrom(value: FormDataEntryValue | null): ImportMode {
	return value === 'replace' ? 'replace' : 'merge';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);

	const account = await loadAccountShape(locals.user.id);
	return {
		counts: account.counts,
		/** Typed back, character for character, before anything is deleted. */
		email: locals.user.email,
		maxBytes: MAX_BUNDLE_BYTES,
		maxLabel: MAX_BUNDLE_LABEL
	};
};

export interface PreviewResult {
	token: string;
	summary: ImportSummary;
}

export const actions: Actions = {
	/** Read a file and say what it would do. Writes nothing. */
	preview: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const file = form.get('file');
		const mode = modeFrom(form.get('mode'));

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { errors: formError('Choose an export file to import.') });
		}
		// The real byte length, before anything is read into memory. `readBundle()`
		// checks the decoded string against the same cap; this is the one that
		// stops a large body being decoded at all.
		if (file.size > MAX_BUNDLE_BYTES) {
			return fail(400, {
				errors: formError(
					`That file is bigger than ${MAX_BUNDLE_LABEL}, which is more than an export can be.`
				)
			});
		}

		const source = await file.text();
		const outcome = await previewImport(locals.user.id, source, mode);
		if (!outcome.ok) {
			return fail(400, { errors: formError(importProblemMessage(outcome.problem)) });
		}

		const preview: PreviewResult = {
			token: stageBundle(locals.user.id, source, mode),
			summary: outcome.plan.summary
		};
		return { preview };
	},

	/** Confirm the plan that was just shown, and write it in one transaction. */
	apply: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		const staged = token ? readStaged(locals.user.id, token) : null;
		if (!staged) {
			return fail(400, {
				errors: formError('That preview has expired. Choose the file again.')
			});
		}

		// The staged mode, not one read back off the form: what was previewed is
		// what runs.
		const outcome = await applyImport(locals.user.id, staged.source, staged.mode);
		if (!outcome.ok) {
			return fail(400, { errors: formError(importProblemMessage(outcome.problem)) });
		}

		dropStaged(token);
		return { imported: outcome.plan.summary };
	},

	/** Delete the account. The confirmation is checked inside `deleteAccount()`. */
	delete: async ({ request, locals, cookies }) => {
		if (!locals.user) redirect(303, '/login');

		const form = await request.formData();
		const confirmation = String(form.get('confirmation') ?? '');

		const deleted = await deleteAccount(locals.user.id, confirmation);
		if (!deleted) {
			const errors: FormErrors = {
				confirmation: 'Type the account’s email address exactly to confirm.'
			};
			return fail(400, { errors });
		}

		dropStagedFor(locals.user.id);
		// The sessions went with the user row, so the cookie is already dead;
		// clearing it stops the browser sending one that resolves to nothing.
		clearSessionCookie(cookies);
		redirect(303, '/');
	}
};
