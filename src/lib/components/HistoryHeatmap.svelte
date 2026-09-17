<script lang="ts">
	import { dayGrid, type HistoryCell } from '$domain/history';
	import { periodName } from '$domain/period';
	import { formatAmount, orbitStanding } from '$domain/progress';
	import type { MetricDefinition } from '$domain/types';
	import type { Cadence } from '$domain/tiers';

	/**
	 * The calendar heatmap for issue #15 — one cell per period at the goal's own
	 * cadence, coloured by how much of the target it carried.
	 *
	 * Daily cadences draw as a GitHub-style week grid, because that is the case
	 * the spec's "a year of daily entries" performance line is about; every
	 * coarser cadence has too few cells per page to need one, and wraps as a
	 * plain row instead. Either way a cell is a `<button>` rather than a
	 * decoration — hover, focus and a tap all select it, and the one selected
	 * cell's entries are read out below rather than in a tooltip that a tap
	 * could never reach.
	 */
	interface Props {
		cells: readonly HistoryCell[];
		cadence: Cadence;
		timeZone: string;
		color: string;
		metric: MetricDefinition;
	}

	let { cells, cadence, timeZone, color, metric }: Props = $props();

	// Starts on the most recent cell. The caller keys this component on the
	// page number, so a fresh page gets a fresh instance rather than carrying
	// over whatever was selected on the page before it.
	/* svelte-ignore state_referenced_locally */
	let selected = $state(cells.length - 1);

	const grid = $derived(cadence === 'day' ? dayGrid(cells, timeZone) : null);
	const weeks = $derived(grid ? Math.max(...grid.map((cell) => cell.week)) + 1 : 0);

	const current = $derived(cells[selected] as HistoryCell | undefined);

	const timeFormatter = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});

	function select(index: number) {
		selected = index;
	}

	function cellLabel(cell: HistoryCell): string {
		return `${periodName(cell.orbit.period.key)}: ${orbitStanding(cell.orbit)}`;
	}
</script>

<div class="heatmap">
	{#if grid}
		<div
			class="grid"
			style="grid-template-columns: repeat({weeks}, 1fr); --color: {color}"
			role="list"
		>
			{#each grid as { cell, week, weekday }, index (cell.orbit.period.key)}
				<button
					type="button"
					class="cell"
					class:is-complete={cell.orbit.complete}
					class:is-dormant={cell.orbit.dormant}
					class:is-selected={index === selected}
					style="grid-row: {weekday + 1}; grid-column: {week + 1}; --fill: {cell.orbit.fraction}"
					aria-label={cellLabel(cell)}
					aria-pressed={index === selected}
					onmouseenter={() => select(index)}
					onfocus={() => select(index)}
					onclick={() => select(index)}
				></button>
			{/each}
		</div>
	{:else}
		<ul class="row">
			{#each cells as cell, index (cell.orbit.period.key)}
				<li>
					<button
						type="button"
						class="cell cell--wide"
						class:is-complete={cell.orbit.complete}
						class:is-dormant={cell.orbit.dormant}
						class:is-selected={index === selected}
						style="--color: {color}; --fill: {cell.orbit.fraction}"
						aria-label={cellLabel(cell)}
						aria-pressed={index === selected}
						onmouseenter={() => select(index)}
						onfocus={() => select(index)}
						onclick={() => select(index)}
					></button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="legend">
		<span class="legend__scale" aria-hidden="true">
			<span class="swatch" style="--color: {color}; --fill: 0"></span>
			<span class="swatch" style="--color: {color}; --fill: 0.33"></span>
			<span class="swatch" style="--color: {color}; --fill: 0.66"></span>
			<span class="swatch is-complete" style="--color: {color}; --fill: 1"></span>
		</span>
		<span class="muted">less → more</span>
		<span class="legend__dormant">
			<span class="swatch is-dormant" aria-hidden="true"></span>
			<span class="muted">dormant — archived, no orbit expected</span>
		</span>
	</div>

	<div class="detail panel" aria-live="polite">
		{#if current}
			<strong>{periodName(current.orbit.period.key)}</strong>
			<span class="muted">
				— {formatAmount(current.orbit.logged, metric)} of {formatAmount(
					current.orbit.target,
					metric
				)}
				{#if current.orbit.dormant}
					(archived — no orbit expected)
				{:else if current.orbit.complete}
					(closed)
				{/if}
			</span>
			{#if current.details.length > 0}
				<ul class="entries">
					{#each current.details as item, index (index)}
						<li>
							<span class="entries__amount">{formatAmount(item.amount, metric)}</span>
							{#if item.label}<span class="muted">{item.label}</span>{/if}
							<span class="muted entries__time">{timeFormatter.format(item.at)}</span>
						</li>
					{/each}
				</ul>
			{:else if !current.orbit.dormant}
				<span class="muted entries__empty">Nothing logged.</span>
			{/if}
		{/if}
	</div>
</div>

<style>
	.heatmap {
		display: grid;
		gap: 0.75rem;
	}

	.grid {
		display: grid;
		gap: 3px;
		grid-auto-columns: minmax(0.65rem, 1fr);
		grid-template-rows: repeat(7, minmax(0.65rem, 1fr));
		overflow-x: auto;
		padding-bottom: 0.2rem;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.cell {
		aspect-ratio: 1;
		background: color-mix(
			in srgb,
			var(--color) calc(var(--fill, 0) * 100%),
			rgba(148, 163, 214, 0.14)
		);
		border: 1px solid var(--space-border);
		border-radius: 3px;
		cursor: pointer;
		height: 0.85rem;
		padding: 0;
		width: 0.85rem;
	}

	.cell--wide {
		border-radius: var(--radius-sm);
		height: 1.6rem;
		width: 1.6rem;
	}

	.cell.is-complete {
		border-color: var(--color);
		box-shadow: 0 0 0 1px var(--color) inset;
	}

	.cell.is-dormant {
		background-image: repeating-linear-gradient(
			45deg,
			rgba(148, 163, 214, 0.35) 0 3px,
			transparent 3px 6px
		);
		border-style: dashed;
		opacity: 0.7;
	}

	.cell.is-selected {
		outline: 2px solid var(--text-bright);
		outline-offset: 1px;
	}

	.legend {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		font-size: var(--text-label);
		gap: 0.4rem 0.6rem;
	}

	.legend__scale {
		display: inline-flex;
		gap: 2px;
	}

	.legend__dormant {
		align-items: center;
		display: inline-flex;
		gap: 0.35rem;
		margin-left: auto;
	}

	.swatch {
		background: color-mix(
			in srgb,
			var(--color) calc(var(--fill, 0) * 100%),
			rgba(148, 163, 214, 0.14)
		);
		border: 1px solid var(--space-border);
		border-radius: 3px;
		display: inline-block;
		height: 0.75rem;
		width: 0.75rem;
	}

	.swatch.is-complete {
		border-color: var(--color);
	}

	.swatch.is-dormant {
		background: none;
		background-image: repeating-linear-gradient(
			45deg,
			rgba(148, 163, 214, 0.35) 0 3px,
			transparent 3px 6px
		);
		border-style: dashed;
	}

	.detail {
		display: grid;
		gap: 0.35rem;
		min-height: 3rem;
		padding: var(--pad-card);
	}

	.entries {
		display: grid;
		gap: 0.2rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.entries li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: var(--text-secondary);
	}

	.entries__amount {
		color: var(--text-bright);
		font-weight: 620;
	}

	.entries__time {
		margin-left: auto;
	}
</style>
