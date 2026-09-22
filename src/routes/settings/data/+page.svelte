<script lang="ts">
	import { resolve } from '$app/paths';
	import FieldError from '$components/FieldError.svelte';
	import { TRANSFER_TABLE_LABEL, TRANSFER_TABLES, type ImportSummary } from '$domain/transfer';
	import { describedBy } from '$domain/validation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const exportHref = resolve('/settings/data/export');

	/** Rows for the "what you have" list, skipping the tables that are empty. */
	const held = $derived(
		TRANSFER_TABLES.map((table) => ({
			table,
			label: TRANSFER_TABLE_LABEL[table],
			count: data.counts[table]
		})).filter((row) => row.count > 0)
	);

	/**
	 * The plan, read as a sentence per table.
	 *
	 * Every number here came out of the plan the write will run, so "would add"
	 * and "added" render from exactly the same shape — the only difference is
	 * the tense, which is why one function does both.
	 */
	function lines(summary: ImportSummary, written: boolean): string[] {
		const sentences: string[] = [];

		for (const table of TRANSFER_TABLES) {
			const row = summary.tables[table];
			if (row.inFile === 0 && row.deleted === 0) continue;

			const parts = [`${written ? 'Added' : 'Would add'} ${row.added} of ${row.inFile}`];
			if (row.duplicate > 0) {
				parts.push(`${row.duplicate} already here`);
			}
			if (row.orphaned > 0) {
				parts.push(`${row.orphaned} dropped for a goal that is not in the file`);
			}
			if (row.deleted > 0) {
				parts.push(`${written ? 'deleted' : 'would delete'} ${row.deleted} already in the account`);
			}
			sentences.push(`${TRANSFER_TABLE_LABEL[table]}: ${parts.join(', ')}.`);
		}

		const reminders = summary.reminderSettings;
		if (reminders.inFile || reminders.deleted) {
			if (reminders.written) {
				sentences.push(`Reminder terms: ${written ? 'restored' : 'would be restored'}.`);
			} else if (reminders.deleted) {
				sentences.push(`Reminder terms: ${written ? 'cleared' : 'would be cleared'}.`);
			} else {
				sentences.push('Reminder terms: left as they are — this account already has some.');
			}
		}

		if (summary.profileRestored) {
			sentences.push(
				`Profile: name, time zone and week start ${written ? 'restored' : 'would be restored'} from the file. Your email address and password never change.`
			);
		}

		return sentences;
	}

	const previewLines = $derived(form?.preview ? lines(form.preview.summary, false) : []);
	const importedLines = $derived(form?.imported ? lines(form.imported, true) : []);
</script>

<svelte:head><title>Your data · Nova</title></svelte:head>

<section class="data">
	<header class="head">
		<div>
			<h1>Your data</h1>
			<p class="muted">
				Nova is yours and so is the record in it. Take the whole thing out as one file, put one
				back, or close the account and leave nothing behind.
			</p>
		</div>
		<a class="button button--ghost" href={resolve('/settings')}>Flight settings</a>
	</header>

	<p class="live" role="status">
		{form?.imported ? 'Import finished.' : ''}
	</p>

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

	<div class="panel form">
		<h2>Export</h2>
		<p class="muted">
			One JSON file with your goals, entries, archive spans, asteroids, orbit notes and reminder
			terms in it. It carries no password, no sign-in and no push subscription — devices are not
			portable, so a restored account signs in again and re-enables reminders where it is standing.
		</p>

		{#if held.length > 0}
			<ul class="counts">
				{#each held as row (row.table)}
					<li><strong>{row.count}</strong> {row.label.toLowerCase()}</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">Nothing is in orbit yet, so the file would only carry your profile.</p>
		{/if}

		<a class="button" href={exportHref} download>Download my data</a>
	</div>

	<div class="panel form">
		<h2>Import</h2>
		<p class="muted">
			Choose a file Nova exported and you will be shown what it would do before anything is written.
			Files up to {data.maxLabel}.
		</p>

		<form method="POST" action="?/preview" enctype="multipart/form-data">
			<div class="field">
				<label for="file">Export file</label>
				<input
					id="file"
					name="file"
					type="file"
					accept="application/json,.json"
					required
					{...describedBy(form?.errors?.file, 'file')}
				/>
				<FieldError id="file" message={form?.errors?.file} />
			</div>

			<fieldset class="field modes">
				<legend>What should it do?</legend>

				<label class="mode">
					<input type="radio" name="mode" value="merge" checked />
					<span>
						<strong>Merge</strong>
						<span class="muted">
							Adds what is in the file and never edits or removes anything already here. Running the
							same file twice changes nothing the second time.
						</span>
					</span>
				</label>

				<label class="mode">
					<input type="radio" name="mode" value="replace" />
					<span>
						<strong>Replace</strong>
						<span class="muted">
							Clears this account's goals, entries, asteroids, notes and reminder terms first, then
							imports the file into the empty account.
						</span>
					</span>
				</label>
			</fieldset>

			<button class="button" type="submit">Check this file</button>
		</form>
	</div>

	{#if form?.preview}
		<div class="panel form plan">
			<h2>What this would do</h2>
			<p class="muted">
				Nothing has been written. This is the plan the import will run, not a summary of one like
				it.
			</p>

			<ul class="plan__lines">
				{#each previewLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>

			<form method="POST" action="?/apply">
				<input type="hidden" name="token" value={form.preview.token} />
				<button
					class="button"
					class:button--danger={form.preview.summary.mode === 'replace'}
					type="submit"
				>
					{form.preview.summary.mode === 'replace' ? 'Replace my data' : 'Import'}
				</button>
			</form>
		</div>
	{/if}

	{#if form?.imported}
		<div class="panel form plan">
			<h2>Imported</h2>
			<ul class="plan__lines">
				{#each importedLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="panel form danger">
		<h2>Delete this account</h2>
		<p class="muted">
			This removes the account and everything under it — every goal, entry, archive span, asteroid,
			note, sign-in and push subscription — and it cannot be undone. Take an export first if there
			is any chance you will want it.
		</p>

		<a class="button button--ghost" href={exportHref} download>Download my data first</a>

		<form method="POST" action="?/delete">
			<div class="field">
				<label for="confirmation">
					Type <strong>{data.email}</strong> to confirm
				</label>
				<input
					id="confirmation"
					name="confirmation"
					type="email"
					autocomplete="off"
					spellcheck="false"
					required
					{...describedBy(form?.errors?.confirmation, 'confirmation')}
				/>
				<FieldError id="confirmation" message={form?.errors?.confirmation} />
			</div>

			<button class="button button--danger" type="submit">Delete my account</button>
		</form>
	</div>
</section>

<style>
	.data {
		display: grid;
		gap: 1.25rem;
		max-width: 40rem;
	}

	.head {
		align-items: start;
		display: flex;
		gap: 1rem;
		justify-content: space-between;
	}

	.head div {
		display: grid;
		gap: 0.35rem;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: 0.9rem;
	}

	.form {
		display: grid;
		gap: 1rem;
		padding: 1.5rem;
	}

	.form h2 {
		margin: 0;
	}

	.form form {
		display: grid;
		gap: 1rem;
		justify-items: start;
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.counts strong {
		color: var(--text-bright);
	}

	.modes {
		border: 0;
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
	}

	.modes legend {
		padding: 0;
	}

	.mode {
		align-items: start;
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		display: flex;
		gap: 0.6rem;
		padding: 0.75rem 0.9rem;
	}

	.mode span {
		display: grid;
		gap: 0.2rem;
	}

	.mode input {
		margin-top: 0.25rem;
	}

	.plan {
		border-color: var(--space-border-bright);
	}

	.plan__lines {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding-left: 1.1rem;
	}

	.danger {
		border-color: rgba(244, 114, 182, 0.35);
	}

	@media (max-width: 34rem) {
		.head {
			flex-direction: column;
		}
	}
</style>
