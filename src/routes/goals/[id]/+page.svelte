<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import OrbitDial from '$components/OrbitDial.svelte';
	import OrbitHistory from '$components/OrbitHistory.svelte';
	import { formatAmount, quickLogSteps } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const goal = $derived(data.snapshot.goal);
	const current = $derived(data.snapshot.current);
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const steps = $derived(quickLogSteps(goal.metric, goal.target));

	let confirmingDelete = $state(false);

	const dateFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
</script>

<svelte:head><title>{goal.title} · Nova</title></svelte:head>

<article class="detail">
	<header class="hero panel">
		<OrbitDial
			orbit={current}
			tier={goal.tier}
			color={goal.color}
			size={230}
			caption="{formatAmount(current.logged, goal.metric)} / {formatAmount(
				goal.target,
				goal.metric
			)}"
		/>

		<div class="hero__copy">
			<p class="tier-tag" style="color: {tierDef.accent}">
				{tierDef.label} · one orbit per {current.period.cadence}
			</p>
			<h1>{goal.title}</h1>
			{#if goal.description}<p class="muted">{goal.description}</p>{/if}

			<p class="status">
				{#if current.complete}
					Orbit closed {CADENCE_LABEL[current.period.cadence]} — {formatAmount(
						current.logged,
						goal.metric
					)} logged.
				{:else}
					{formatAmount(current.remaining, goal.metric)} to go {CADENCE_LABEL[
						current.period.cadence
					]}.
				{/if}
			</p>

			<dl class="stats">
				<div>
					<dt>Streak</dt>
					<dd>{data.snapshot.streak}</dd>
				</div>
				<div>
					<dt>Orbits closed</dt>
					<dd>{data.snapshot.totalOrbits}</dd>
				</div>
				<div>
					<dt>Lifetime</dt>
					<dd>{formatAmount(data.snapshot.lifetimeLogged, goal.metric)}</dd>
				</div>
			</dl>

			<div class="hero__actions">
				<a class="button button--ghost" href={resolve('/goals/[id]/edit', { id: goal.id })}>Edit</a>
				<form method="POST" action="?/archive" use:enhance>
					<input type="hidden" name="archived" value="true" />
					<button class="button button--ghost" type="submit">Archive</button>
				</form>
			</div>
		</div>
	</header>

	<section class="panel block">
		<h2>Log progress</h2>

		{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}
		{#if form?.errors?.amount}<p class="error">{form.errors.amount}</p>{/if}

		<form class="quick" method="POST" action="?/log" use:enhance>
			{#each steps as step (step)}
				<button class="chip" type="submit" name="amount" value={step}>
					+{formatAmount(step, goal.metric)}
				</button>
			{/each}
		</form>

		<form class="custom" method="POST" action="?/log" use:enhance>
			<div class="field">
				<label for="amount">
					Amount {#if goal.metric.kind === 'duration'}<span class="muted">(minutes)</span>{/if}
				</label>
				<input id="amount" name="amount" type="number" step="any" required />
			</div>
			<div class="field">
				<label for="note">Note</label>
				<input id="note" name="note" maxlength="200" placeholder="Optional" />
			</div>
			<button class="button" type="submit">Log it</button>
		</form>
		<p class="muted hint">A negative amount corrects an over-log.</p>
	</section>

	<section class="panel block">
		<h2>Recent orbits</h2>
		<OrbitHistory history={data.snapshot.history} color={goal.color} />
	</section>

	<section class="panel block">
		<h2>Entries</h2>
		{#if data.recentEntries.length === 0}
			<p class="muted">Nothing logged yet. The first entry starts the orbit.</p>
		{:else}
			<ul class="entries">
				{#each data.recentEntries as entry (entry.id)}
					<li>
						<span class="entry__amount">{formatAmount(entry.amount, goal.metric)}</span>
						<span class="muted entry__when">{dateFormatter.format(entry.occurredAt)}</span>
						{#if entry.note}<span class="entry__note muted">{entry.note}</span>{/if}
						<form method="POST" action="?/deleteEntry" use:enhance>
							<input type="hidden" name="entryId" value={entry.id} />
							<button class="link-button" type="submit" aria-label="Delete entry">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="panel block danger-zone">
		<h2>Danger zone</h2>
		{#if confirmingDelete}
			<p class="muted">Deleting removes the goal and every entry logged against it.</p>
			<div class="hero__actions">
				<form method="POST" action="?/delete" use:enhance>
					<button class="button button--danger" type="submit">Yes, delete it</button>
				</form>
				<button
					class="button button--ghost"
					type="button"
					onclick={() => (confirmingDelete = false)}
				>
					Keep it
				</button>
			</div>
		{:else}
			<button class="button button--danger" type="button" onclick={() => (confirmingDelete = true)}>
				Delete goal
			</button>
		{/if}
	</section>
</article>

<style>
	.detail {
		display: grid;
		gap: 1.25rem;
	}

	.hero {
		align-items: center;
		display: grid;
		gap: 1.5rem;
		grid-template-columns: auto 1fr;
		padding: 1.75rem;
	}

	.hero__copy {
		display: grid;
		gap: 0.7rem;
	}

	.tier-tag {
		font-size: 0.8rem;
		font-weight: 640;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.status {
		color: var(--text-bright);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
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
		font-size: 1.1rem;
		font-weight: 640;
		margin: 0;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.block {
		display: grid;
		gap: 0.9rem;
		padding: 1.35rem;
	}

	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.chip {
		background: rgba(10, 14, 36, 0.8);
		border: 1px solid var(--space-border);
		border-radius: 999px;
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		min-height: 2.5rem;
		padding: 0.35rem 1rem;
	}

	.chip:hover {
		border-color: var(--space-border-bright);
	}

	.custom {
		align-items: end;
		display: grid;
		gap: 0.75rem;
		grid-template-columns: 1fr 1.4fr auto;
	}

	.hint {
		font-size: 0.82rem;
	}

	.entries {
		display: grid;
		gap: 0.1rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.entries li {
		align-items: center;
		border-bottom: 1px solid var(--space-border);
		display: grid;
		gap: 0.75rem;
		grid-template-columns: auto auto 1fr auto;
		padding: 0.55rem 0;
	}

	.entries li:last-child {
		border-bottom: none;
	}

	.entry__amount {
		color: var(--text-bright);
		font-weight: 620;
	}

	.entry__when,
	.entry__note {
		font-size: 0.88rem;
	}

	.link-button {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.25rem;
	}

	.link-button:hover {
		color: var(--danger);
	}

	.danger-zone {
		justify-items: start;
	}

	@media (max-width: 48rem) {
		.hero {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}

		.hero__copy {
			justify-items: center;
		}

		.stats,
		.hero__actions,
		.quick {
			justify-content: center;
		}

		.custom {
			grid-template-columns: 1fr;
		}

		.entries li {
			grid-template-columns: auto 1fr auto;
		}

		.entry__note {
			grid-column: 1 / -1;
		}
	}
</style>
