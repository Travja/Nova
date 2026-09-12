<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import OrbitDial from '$components/OrbitDial.svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import { formatAmount, quickLogSteps } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';

	interface Props {
		snapshot: GoalSnapshot;
		/** Set while a log request for this goal is in flight. */
		pending?: boolean;
	}

	let { snapshot, pending = false }: Props = $props();

	const goal = $derived(snapshot.goal);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const steps = $derived(quickLogSteps(goal.metric, goal.target));
	const caption = $derived(
		`${formatAmount(snapshot.current.logged, goal.metric)} / ${formatAmount(goal.target, goal.metric)}`
	);
	const percent = $derived(Math.round(snapshot.current.fraction * 100));
</script>

<article class="card panel" class:card--complete={snapshot.current.complete}>
	<a class="dial-link" href={goalHref} aria-label="Open {goal.title}">
		<OrbitDial orbit={snapshot.current} tier={goal.tier} color={goal.color} size={168} {caption} />
	</a>

	<div class="body">
		<div class="heading">
			<h3><a href={goalHref}>{goal.title}</a></h3>
			<p class="muted status">
				{#if snapshot.current.complete}
					Orbit closed {CADENCE_LABEL[snapshot.current.period.cadence]} ✦
				{:else}
					{formatAmount(snapshot.current.remaining, goal.metric)} left {CADENCE_LABEL[
						snapshot.current.period.cadence
					]}
				{/if}
			</p>
		</div>

		<div
			class="meter"
			role="progressbar"
			aria-valuenow={percent}
			aria-valuemin="0"
			aria-valuemax="100"
			aria-label="{goal.title} progress"
		>
			<span style="width: {percent}%; background: {goal.color}"></span>
		</div>

		<dl class="stats">
			<div>
				<dt>Streak</dt>
				<dd>{snapshot.streak}</dd>
			</div>
			<div>
				<dt>Orbits</dt>
				<dd>{snapshot.totalOrbits}</dd>
			</div>
			<div>
				<dt>Tier</dt>
				<dd style="color: {tierDef.accent}">{tierDef.label}</dd>
			</div>
		</dl>

		<form class="quick-log" method="POST" action="{resolve('/')}?/log" use:enhance>
			<input type="hidden" name="goalId" value={goal.id} />
			{#each steps as step (step)}
				<button class="chip" type="submit" name="amount" value={step} disabled={pending}>
					+{formatAmount(step, goal.metric)}
				</button>
			{/each}
			<a class="chip chip--ghost" href={goalHref}>More…</a>
		</form>
	</div>
</article>

<style>
	.card {
		align-items: center;
		display: grid;
		gap: 1rem;
		grid-template-columns: auto 1fr;
		padding: 1.1rem;
		transition: border-color 200ms ease;
	}

	.card--complete {
		border-color: var(--space-border-bright);
	}

	.dial-link:hover {
		text-decoration: none;
	}

	.body {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}

	.heading h3 {
		font-size: 1.1rem;
	}

	.heading h3 a {
		color: var(--text-bright);
	}

	.status {
		font-size: 0.88rem;
	}

	.meter {
		background: rgba(6, 9, 26, 0.7);
		border-radius: 999px;
		height: 6px;
		overflow: hidden;
	}

	.meter span {
		border-radius: 999px;
		display: block;
		height: 100%;
		transition: width 700ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.stats {
		display: flex;
		gap: 1.25rem;
		margin: 0;
	}

	.stats div {
		display: grid;
		gap: 0.1rem;
	}

	dt {
		color: var(--text-dim);
		font-size: 0.7rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	dd {
		color: var(--text-bright);
		font-weight: 620;
		margin: 0;
	}

	.quick-log {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		background: rgba(10, 14, 36, 0.8);
		border: 1px solid var(--space-border);
		border-radius: 999px;
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		font-size: 0.85rem;
		min-height: 2.25rem;
		padding: 0.3rem 0.8rem;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	.chip:hover {
		border-color: var(--space-border-bright);
		text-decoration: none;
	}

	.chip:active {
		transform: translateY(1px);
	}

	.chip--ghost {
		align-items: center;
		color: var(--text-dim);
		display: inline-flex;
	}

	@media (max-width: 34rem) {
		.card {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}

		.body {
			justify-items: center;
			width: 100%;
		}

		.stats,
		.quick-log {
			justify-content: center;
		}
	}
</style>
