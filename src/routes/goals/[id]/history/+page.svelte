<script lang="ts">
	import { resolve } from '$app/paths';
	import HistoryHeatmap from '$components/HistoryHeatmap.svelte';
	import { periodName } from '$domain/period';
	import { formatAmount } from '$domain/progress';
	import { cadenceOf, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const goal = $derived(data.goal);
	const cadence = $derived(cadenceOf(goal.tier));
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	const historyHref = $derived(resolve('/goals/[id]/history', { id: goal.id }));

	/** Newest first — the orbit list reads like the entries list beside it. */
	const orbits = $derived([...data.cells].reverse());
</script>

<svelte:head><title>History · {goal.title} · Nova</title></svelte:head>

<article class="history-page">
	<header class="head">
		<p class="tier-tag" style="color: {tierDef.accent}">
			{tierDef.label} · one orbit per {cadence}{data.derived ? ' · derived' : ''}
		</p>
		<h1>{goal.title}</h1>
		<a class="button button--ghost" href={goalHref}>Back to the goal</a>
	</header>

	<section class="panel block">
		<h2>Heatmap</h2>
		<p class="muted">
			{#if data.derived}
				Each cell is the orbits its children closed that {cadence}.
			{:else}
				Each cell is how much of the target landed that {cadence}.
			{/if}
			Page {data.page + 1}.
		</p>
		{#key data.page}
			<HistoryHeatmap
				cells={data.cells}
				{cadence}
				timeZone={data.timeZone}
				color={goal.color}
				metric={data.metric}
			/>
		{/key}
	</section>

	<section class="panel block">
		<h2>Orbits</h2>
		{#if orbits.length === 0}
			<p class="muted">Nothing in this page yet.</p>
		{:else}
			<ul class="orbits">
				{#each orbits as cell (cell.orbit.period.key)}
					<li class:is-dormant={cell.orbit.dormant}>
						<span class="orbits__period">{periodName(cell.orbit.period.key)}</span>
						<span class="orbits__amount muted">
							{formatAmount(cell.orbit.logged, data.metric)} / {formatAmount(
								cell.orbit.target,
								data.metric
							)}
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
		{/if}

		<nav class="pager">
			{#if data.hasNewer}
				<a class="button button--ghost" href="{historyHref}?page={data.page - 1}">Newer</a>
			{/if}
			{#if data.hasOlder}
				<a class="button button--ghost" href="{historyHref}?page={data.page + 1}">Older</a>
			{/if}
		</nav>
	</section>
</article>

<style>
	.history-page {
		display: grid;
		gap: var(--gap-view);
	}

	.head {
		display: grid;
		gap: 0.4rem;
		justify-items: start;
	}

	.tier-tag {
		font-size: var(--text-secondary);
		font-weight: 640;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.block {
		display: grid;
		gap: var(--gap-block);
		padding: var(--pad-panel);
	}

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

	.pager {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
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
