<script lang="ts">
	import { enhance } from '$app/forms';
	import { periodName } from '$domain/period';
	import { formatAmount } from '$domain/progress';
	import { describedBy, ORBIT_NOTE_MAX_LENGTH } from '$domain/validation';
	import FieldError from '$components/FieldError.svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { HistoryCell } from '$domain/history';
	import type { MetricDefinition } from '$domain/types';
	import type { FormErrors } from '$domain/validation';

	/**
	 * The full orbit list for one history page, revealed a chunk at a time.
	 *
	 * A daily goal's page carries up to 371 orbits — plenty to page a server
	 * query over, but not something worth putting 371 rows of DOM in front of a
	 * pilot who came to check last week. The caller keys this component on the
	 * page number, so paging the heatmap starts the list fresh at the same
	 * chunk size rather than carrying over how far a previous page was expanded.
	 *
	 * A note lives on the same row as the orbit it is about (#18) — read when
	 * present, written or edited in place. Which row is open is driven by the
	 * URL, the same way the entry list on the goal page drives its own editing
	 * — a row survives a submit with no JavaScript. `historyHref` is the page's
	 * own `resolve()`d path, threaded through so the note links can be built
	 * from it rather than this component inventing its own route.
	 */
	interface Props {
		/** Oldest first, as a history page loads them. */
		cells: readonly HistoryCell[];
		metric: MetricDefinition;
		historyHref: ResolvedPathname;
		page: number;
		/** The period key whose note is open for editing, or null. */
		editingNote: string | null;
		noteErrors?: FormErrors | null;
	}

	let { cells, metric, historyHref, page, editingNote, noteErrors = null }: Props = $props();

	const CHUNK = 20;
	let shown = $state(CHUNK);

	/** Newest first — reads like the entries list beside it. */
	const orbits = $derived([...cells].reverse());
	const visible = $derived(orbits.slice(0, shown));
	const remaining = $derived(orbits.length - visible.length);

	function showMore() {
		shown += CHUNK;
	}
</script>

{#if orbits.length === 0}
	<p class="muted">Nothing in this page yet.</p>
{:else}
	<ul class="orbits">
		{#each visible as cell (cell.orbit.period.key)}
			{@const key = cell.orbit.period.key}
			{@const name = periodName(key)}
			<li class:is-dormant={cell.orbit.dormant} class:orbits__row--editing={editingNote === key}>
				<span class="orbits__period">{name}</span>
				<span class="orbits__amount muted">
					{formatAmount(cell.orbit.logged, metric)} / {formatAmount(cell.orbit.target, metric)}
				</span>
				<span class="orbits__status">
					{#if cell.orbit.dormant}
						<span class="pill pill--dormant">Dormant</span>
					{:else if cell.orbit.complete}
						<span class="pill pill--closed">Closed</span>
					{:else}
						<span class="muted">Open</span>
					{/if}
				</span>

				{#if editingNote === key}
					<div class="note-edit">
						<form method="POST" action="?/note" use:enhance>
							<input type="hidden" name="periodKey" value={key} />
							<input
								type="hidden"
								name="periodStart"
								value={cell.orbit.period.start.toISOString()}
							/>
							<label class="visually-hidden" for="note-{key}">Note for {name}</label>
							<textarea
								id="note-{key}"
								name="body"
								rows="3"
								maxlength={ORBIT_NOTE_MAX_LENGTH}
								placeholder="What made this one worth remembering?"
								{...describedBy(noteErrors?.body, `note-${key}`)}>{cell.note?.body ?? ''}</textarea
							>
							<FieldError id="note-{key}" message={noteErrors?.body} />
							<div class="note-edit__actions">
								<button class="button" type="submit">Save note</button>
								<a class="button button--ghost" href="{historyHref}?page={page}">Cancel</a>
							</div>
						</form>
						{#if cell.note}
							<form method="POST" action="?/clearNote" use:enhance>
								<input type="hidden" name="periodKey" value={key} />
								<button class="link-button tap" type="submit">Clear note</button>
							</form>
						{/if}
					</div>
				{:else}
					{#if cell.note}<p class="orbits__note">{cell.note.body}</p>{/if}
					<a
						class="link-button tap orbits__note-link"
						href="{historyHref}?page={page}&note={encodeURIComponent(key)}"
					>
						{cell.note ? 'Edit note' : 'Add note'}
						<span class="visually-hidden">for {name}</span>
					</a>
				{/if}
			</li>
		{/each}
	</ul>

	{#if remaining > 0}
		<button type="button" class="button button--ghost show-more tap" onclick={showMore}>
			Show {Math.min(CHUNK, remaining)} more
			<span class="muted">({remaining} left on this page)</span>
		</button>
	{/if}
{/if}

<style>
	.orbits {
		display: grid;
		gap: 0.1rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.orbits li {
		align-items: center;
		border-bottom: 1px solid var(--space-border);
		display: grid;
		gap: 0.6rem;
		grid-template-columns: 1fr auto auto;
		padding: 0.4rem 0;
	}

	.orbits li:last-child {
		border-bottom: none;
	}

	.orbits li.is-dormant {
		opacity: 0.7;
	}

	.orbits li.orbits__row--editing {
		grid-template-columns: 1fr;
	}

	.orbits__period {
		color: var(--text-bright);
	}

	.orbits__note {
		color: var(--text-dim);
		font-size: var(--text-secondary);
		grid-column: 1 / -1;
		margin: 0;
		white-space: pre-wrap;
	}

	.orbits__note-link {
		grid-column: 1 / -1;
		justify-self: start;
	}

	.note-edit {
		display: grid;
		gap: 0.5rem;
		grid-column: 1 / -1;
		width: 100%;
	}

	.note-edit textarea {
		min-height: 4.5rem;
	}

	.note-edit__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Same treatment as the Edit/Remove pair on the entries list. */
	.link-button {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		padding: 0.25rem;
	}

	.link-button:hover {
		color: var(--text-bright);
		text-decoration: none;
	}

	form .link-button:hover {
		color: var(--danger);
	}

	.pill {
		border: 1px solid currentColor;
		border-radius: 999px;
		font-size: var(--text-label);
		font-weight: 640;
		letter-spacing: 0.06em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.pill--closed {
		color: var(--success);
	}

	.pill--dormant {
		color: var(--text-dim);
	}

	.show-more {
		justify-self: start;
		margin-top: 0.4rem;
	}

	@media (max-width: 40rem) {
		.orbits li {
			grid-template-columns: 1fr auto;
		}

		.orbits li.orbits__row--editing {
			grid-template-columns: 1fr;
		}

		.orbits__status {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
</style>
