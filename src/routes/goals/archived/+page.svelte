<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import OrbitDial from '$components/OrbitDial.svelte';
	import { formatAmount } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const snapshots = $derived(data.snapshots);

	const archivedOn = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
</script>

<svelte:head><title>Archived goals · Nova</title></svelte:head>

<section class="archive">
	<header class="head">
		<div>
			<h1>Archived goals</h1>
			<p class="muted">
				Nothing here is counted on the dashboard, and no orbit is expected while a goal is archived.
				Everything logged is still here, and a streak picks up where it froze.
			</p>
		</div>
		<a class="button button--ghost" href={resolve('/')}>Back to orbit</a>
	</header>

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

	<p class="live" role="status">
		{form?.restored ? `${form.restored} is back in orbit.` : ''}
	</p>

	{#if snapshots.length === 0}
		<div class="empty panel">
			<Astronaut size={150} />
			<h2>Nothing archived</h2>
			<p class="muted">
				Archiving a goal parks it here with its history intact, for when a season ends but the
				record still matters.
			</p>
		</div>
	{:else}
		<ul class="list">
			{#each snapshots as snapshot (snapshot.goal.id)}
				{@const goal = snapshot.goal}
				{@const metric = metricFor(snapshot)}
				<li class="card panel">
					<OrbitDial
						orbit={snapshot.current}
						tier={goal.tier}
						color={goal.color}
						goalId={goal.id}
						size={120}
						satellites={snapshot.derived?.children ?? []}
						caption="{formatAmount(snapshot.current.logged, metric)} / {formatAmount(
							goal.target,
							metric
						)}"
					/>

					<div class="body">
						<div class="heading">
							<h2>
								<a href={resolve('/goals/[id]', { id: goal.id })}>{goal.title}</a>
							</h2>
							<p class="muted" style="color: {TIER_DEFINITIONS[goal.tier].accent}">
								{TIER_DEFINITIONS[goal.tier].label}
								{#if goal.archivedAt}
									<span class="muted">· archived {archivedOn.format(goal.archivedAt)}</span>
								{/if}
							</p>
						</div>

						<dl class="stats">
							<div>
								<dt>Orbits closed</dt>
								<dd>{snapshot.totalOrbits}</dd>
							</div>
							<div>
								<dt>Streak when archived</dt>
								<dd>{snapshot.streak}</dd>
							</div>
							<div>
								<dt>{snapshot.derived ? 'Orbits fed in' : 'Lifetime'}</dt>
								<dd>{formatAmount(snapshot.lifetimeLogged, metric)}</dd>
							</div>
						</dl>
					</div>

					<form method="POST" action="?/restore" use:enhance>
						<input type="hidden" name="goalId" value={goal.id} />
						<input type="hidden" name="title" value={goal.title} />
						<!-- A list of buttons all called "Restore" is a list of buttons
						     nobody can tell apart by name. -->
						<button class="button" type="submit">
							Restore <span class="visually-hidden">{goal.title}</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.archive {
		display: grid;
		gap: var(--gap-view);
	}

	.head {
		align-items: end;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
	}

	.head p {
		max-width: 52ch;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: var(--text-secondary);
	}

	.empty {
		display: grid;
		gap: var(--gap-block);
		justify-items: center;
		padding: 2rem 1.25rem;
		text-align: center;
	}

	.empty p {
		max-width: 44ch;
	}

	.list {
		display: grid;
		gap: var(--gap-list);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.card {
		align-items: center;
		display: grid;
		gap: var(--gap-card);
		grid-template-columns: auto 1fr auto;
		padding: var(--pad-card);
	}

	.body {
		display: grid;
		gap: var(--gap-block);
		min-width: 0;
	}

	.heading h2 {
		font-size: 1.1rem;
	}

	.heading h2 a {
		color: var(--text-bright);
	}

	.heading p {
		font-size: var(--text-secondary);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.9rem;
		margin: 0;
	}

	.stats div {
		display: grid;
		gap: 0.1rem;
	}

	dt {
		color: var(--text-dim);
		font-size: var(--text-label);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	dd {
		color: var(--text-bright);
		font-weight: 620;
		margin: 0;
	}

	@media (max-width: 44rem) {
		.card {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}

		.body {
			justify-items: center;
		}

		.stats {
			justify-content: center;
		}
	}
</style>
