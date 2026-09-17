<script lang="ts">
	import { periodName } from '$domain/period';
	import { formatAmount } from '$domain/progress';
	import type { HistoryCell } from '$domain/history';
	import type { MetricDefinition } from '$domain/types';

	/**
	 * The full orbit list for one history page, revealed a chunk at a time.
	 *
	 * A daily goal's page carries up to 371 orbits — plenty to page a server
	 * query over, but not something worth putting 371 rows of DOM in front of a
	 * pilot who came to check last week. The caller keys this component on the
	 * page number, so paging the heatmap starts the list fresh at the same
	 * chunk size rather than carrying over how far a previous page was expanded.
	 */
	interface Props {
		/** Oldest first, as a history page loads them. */
		cells: readonly HistoryCell[];
		metric: MetricDefinition;
	}

	let { cells, metric }: Props = $props();

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
			<li class:is-dormant={cell.orbit.dormant}>
				<span class="orbits__period">{periodName(cell.orbit.period.key)}</span>
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

	.orbits__period {
		color: var(--text-bright);
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

		.orbits__status {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
</style>
