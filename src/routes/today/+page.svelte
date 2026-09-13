<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import GoalCard from '$components/GoalCard.svelte';
	import type { FocusRow, GoalSnapshot } from '$domain/progress';
	import { focusForToday, formatAmount, formatTimeLeft, periodElapsed } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const snapshots = $derived(data.snapshots);
	/** Ranked on the same clock the orbits were measured against. */
	const focus = $derived(focusForToday(snapshots, data.now));
	const logAction = $derived(`${resolve('/today')}?/log`);

	function timeLeft(snapshot: GoalSnapshot): string {
		return formatTimeLeft(snapshot.current.period, data.now);
	}

	function standing(snapshot: GoalSnapshot): string {
		const { goal, current } = snapshot;
		return `${formatAmount(current.logged, goal.metric)} / ${formatAmount(goal.target, goal.metric)}`;
	}

	function percent(fraction: number): number {
		return Math.round(fraction * 100);
	}

	/**
	 * Why this row is here. A closing period speaks for itself in time left; a
	 * goal behind pace with months to run has to say so, and the two numbers that
	 * make the case are the ones worth showing.
	 */
	function reason(row: FocusRow): string {
		const { snapshot } = row;
		const cadence = CADENCE_LABEL[snapshot.current.period.cadence];
		if (row.closing) return `${timeLeft(snapshot)} of ${cadence}`;
		const gone = periodElapsed(snapshot.current.period, data.now, snapshot.goal.createdAt);
		return `${percent(snapshot.current.fraction)}% done, ${percent(gone)}% of ${cadence} gone`;
	}
</script>

<svelte:head>
	<title>Today · Nova</title>
	<meta name="description" content="What needs attention before the period closes." />
</svelte:head>

<section class="today">
	<header class="head">
		<div>
			<h1>Today</h1>
			<p class="muted">
				{#if snapshots.length === 0}
					Nothing in orbit yet.
				{:else if focus.atRisk.length === 0}
					Nothing at risk. {focus.closed.length}
					{focus.closed.length === 1 ? 'orbit' : 'orbits'} closed.
				{:else}
					{focus.atRisk.length}
					{focus.atRisk.length === 1 ? 'orbit needs' : 'orbits need'} attention — running out of time
					or behind pace.
				{/if}
			</p>
		</div>
		<a class="button button--ghost" href={resolve('/')}>All tiers</a>
	</header>

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

	<p class="live" role="status">{form?.logged ? 'Logged.' : ''}</p>

	{#if snapshots.length === 0}
		<div class="empty panel">
			<Astronaut size={170} />
			<h2>Nothing in orbit yet</h2>
			<p class="muted">
				Today has nothing to ask of you until something is flying. A Satellite closes every day,
				which is the quickest way to see this screen earn its keep.
			</p>
			<a class="button" href={resolve('/goals/new')}>Launch a goal</a>
		</div>
	{:else if focus.atRisk.length === 0}
		<div class="empty panel">
			<Astronaut size={170} />
			<h2>Clear sky</h2>
			<p class="muted">
				Nothing is short of target with its period closing, and nothing is behind the pace its
				period asks for. Whatever is still in flight has room left.
			</p>
		</div>
	{:else}
		<ul class="risk">
			{#each focus.atRisk as row (row.snapshot.goal.id)}
				<li>
					<p class="deadline">
						<span class="pill" style="color: {TIER_DEFINITIONS[row.snapshot.goal.tier].accent}">
							{TIER_DEFINITIONS[row.snapshot.goal.tier].label}
						</span>
						{#if row.behindPace && !row.closing}
							<span class="flag">Behind pace</span>
						{/if}
						<span class="muted">{reason(row)}</span>
					</p>
					<GoalCard snapshot={row.snapshot} {logAction} />
				</li>
			{/each}
		</ul>
	{/if}

	{#if focus.closed.length > 0}
		<details class="fold" open>
			<summary>
				Closed ({focus.closed.length}) ✦
			</summary>
			<ul class="compact">
				{#each focus.closed as snapshot (snapshot.goal.id)}
					<li>
						<a href={resolve('/goals/[id]', { id: snapshot.goal.id })}>{snapshot.goal.title}</a>
						<span class="muted">{standing(snapshot)}</span>
						<span class="done">closed {CADENCE_LABEL[snapshot.current.period.cadence]}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if focus.steady.length > 0}
		<details class="fold">
			<summary>
				Flying steady ({focus.steady.length})
			</summary>
			<p class="muted fold__note">
				Still in flight and on pace, the one furthest behind first. Nothing here is owed today.
			</p>
			<ul class="compact">
				{#each focus.steady as row (row.snapshot.goal.id)}
					<li>
						<a href={resolve('/goals/[id]', { id: row.snapshot.goal.id })}
							>{row.snapshot.goal.title}</a
						>
						<span class="muted">{standing(row.snapshot)}</span>
						<span class="muted">{timeLeft(row.snapshot)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.today {
		display: grid;
		gap: 1.5rem;
	}

	.head {
		align-items: end;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: 0.9rem;
		margin: -1.25rem 0 0;
	}

	.empty {
		display: grid;
		gap: 1rem;
		justify-items: center;
		padding: 2.5rem 1.5rem;
		text-align: center;
	}

	.risk {
		display: grid;
		gap: 1.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.deadline {
		align-items: baseline;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin: 0 0 0.4rem;
	}

	.pill {
		border: 1px solid currentColor;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 640;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.flag {
		border: 1px solid currentColor;
		border-radius: 999px;
		color: var(--accent-warm);
		font-size: 0.7rem;
		font-weight: 640;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.deadline .muted {
		font-size: 0.85rem;
	}

	.fold {
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		padding: 0.75rem 1rem;
	}

	summary {
		color: var(--text-bright);
		cursor: pointer;
		font-weight: 600;
	}

	.fold__note {
		font-size: 0.85rem;
		margin: 0.6rem 0 0;
		max-width: 60ch;
	}

	.compact {
		display: grid;
		gap: 0.5rem;
		list-style: none;
		margin: 0.75rem 0 0;
		padding: 0;
	}

	.compact li {
		align-items: baseline;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: space-between;
	}

	.compact a {
		color: var(--text-bright);
	}

	.compact span {
		font-size: 0.85rem;
	}

	.done {
		color: var(--success);
		font-size: 0.85rem;
	}
</style>
