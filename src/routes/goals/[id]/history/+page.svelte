<script lang="ts">
	import { resolve } from '$app/paths';
	import HistoryHeatmap from '$components/HistoryHeatmap.svelte';
	import OrbitList from '$components/OrbitList.svelte';
	import { cadenceOf, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const goal = $derived(data.goal);
	const cadence = $derived(cadenceOf(goal.tier));
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	const historyHref = $derived(resolve('/goals/[id]/history', { id: goal.id }));
	/**
	 * Which period's note is open. The URL drives it, same as the entry editor
	 * on the goal page, so a note survives a submit without JavaScript; a saved
	 * note closes it again.
	 */
	const editingNote = $derived(form?.noteSaved ? null : data.editingNote);
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
		{#key data.page}
			<OrbitList
				cells={data.cells}
				metric={data.metric}
				{historyHref}
				page={data.page}
				{editingNote}
				noteErrors={form?.errors}
			/>
		{/key}

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

	.pager {
		display: flex;
		gap: 0.6rem;
		justify-content: flex-end;
	}
</style>
