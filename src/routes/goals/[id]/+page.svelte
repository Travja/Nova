<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import OrbitDial from '$components/OrbitDial.svelte';
	import OrbitHistory from '$components/OrbitHistory.svelte';
	import { toLocalDateTime } from '$domain/period';
	import { formatAmount, quickLogSteps } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const goal = $derived(data.snapshot.goal);
	const current = $derived(data.snapshot.current);
	const archived = $derived(goal.archivedAt !== null);
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const steps = $derived(quickLogSteps(goal.metric, goal.target));
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	/**
	 * Which entry the list is editing. The URL drives it so the row survives a
	 * submit without JavaScript; a saved edit closes it again.
	 */
	const editing = $derived(form?.edited ? null : data.editing);

	let confirmingDelete = $state(false);

	/**
	 * What to say after an entry lands. One string rather than a block, so the
	 * live region is genuinely empty when there is nothing to announce.
	 */
	const orbitMessage = $derived.by(() => {
		if (form?.orbit && !form.orbit.current) {
			const logged = formatAmount(form.orbit.logged, goal.metric);
			const standing = form.orbit.closed
				? `that orbit is closed at ${logged}.`
				: `that orbit now stands at ${logged} of ${formatAmount(form.orbit.target, goal.metric)}.`;
			return `${form.edited ? 'Moved' : 'Logged'} to ${form.orbit.label}, which is already over — ${standing} The orbit in flight is unchanged.`;
		}
		if (form?.edited) return 'Entry updated.';
		return '';
	});

	const dateFormatter = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	});

	let whenInput: HTMLInputElement | null = $state(null);
	/** Set once the pilot picks their own time, so we stop moving it. */
	let whenDirty = $state(false);

	/**
	 * A page left open for hours would otherwise default new entries to whenever
	 * it was rendered. Only the browser's clock can fix that, and only while it
	 * agrees with the zone the account keeps its periods in.
	 */
	function syncWhen() {
		if (!whenInput || whenDirty) return;
		if (Intl.DateTimeFormat().resolvedOptions().timeZone !== data.timeZone) return;
		whenInput.value = toLocalDateTime(new Date(), data.timeZone);
	}

	onMount(() => {
		syncWhen();
		document.addEventListener('visibilitychange', syncWhen);
		return () => document.removeEventListener('visibilitychange', syncWhen);
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
				{#if archived}
					Archived — this is the orbit it stopped on.
				{:else if current.complete}
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
					<dt>{archived ? 'Streak when archived' : 'Streak'}</dt>
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
				{#if archived}
					<form method="POST" action="?/archive" use:enhance>
						<input type="hidden" name="archived" value="false" />
						<button class="button" type="submit">Restore to orbit</button>
					</form>
					<a class="button button--ghost" href={resolve('/goals/archived')}>All archived goals</a>
				{:else}
					<a class="button button--ghost" href={resolve('/goals/[id]/edit', { id: goal.id })}
						>Edit</a
					>
					<a class="button button--ghost" href="{goalHref}?confirm=archive">Archive</a>
				{/if}
			</div>
		</div>
	</header>

	{#if archived}
		<p class="notice panel">
			This goal is parked. It is off the dashboard and no orbit is expected of it, but every entry
			is still here and the streak is frozen rather than broken — restore it and it carries on from
			{data.snapshot.streak}
			{data.snapshot.streak === 1 ? 'orbit' : 'orbits'}.
		</p>
	{:else if data.confirmingArchive}
		<section class="notice panel confirm">
			<h2>Archive {goal.title}?</h2>
			<ul>
				<li>Every entry stays exactly where it is.</li>
				<li>The goal leaves the dashboard and stops asking for progress.</li>
				<li>
					The streak freezes at {data.snapshot.streak} rather than breaking — the periods it spends archived
					are not counted as missed.
				</li>
			</ul>
			<div class="hero__actions">
				<form method="POST" action="?/archive" use:enhance>
					<input type="hidden" name="archived" value="true" />
					<button class="button" type="submit">Archive it</button>
				</form>
				<a class="button button--ghost" href={goalHref}>Keep flying</a>
			</div>
		</section>
	{/if}

	{#if !archived}
		<section class="panel block">
			<h2>Log progress</h2>

			{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}
			{#if form?.errors?.amount}<p class="error">{form.errors.amount}</p>{/if}
			{#if form?.errors?.occurredAt}<p class="error">{form.errors.occurredAt}</p>{/if}

			<p class="live" role="status">{orbitMessage}</p>

			<form class="quick" method="POST" action="?/log" use:enhance>
				{#each steps as step (step)}
					<button class="chip" type="submit" name="amount" value={step}>
						+{formatAmount(step, goal.metric)}
					</button>
				{/each}
			</form>

			<form
				class="custom"
				method="POST"
				action="?/log"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						whenDirty = false;
						syncWhen();
					}}
			>
				<div class="field">
					<label for="amount">
						Amount {#if goal.metric.kind === 'duration'}<span class="muted">(minutes)</span>{/if}
					</label>
					<input id="amount" name="amount" type="number" step="any" required />
				</div>
				<div class="field">
					<label for="occurredAt">When</label>
					<input
						bind:this={whenInput}
						id="occurredAt"
						name="occurredAt"
						type="datetime-local"
						defaultValue={data.occurredAt.now}
						min={data.occurredAt.min}
						max={data.occurredAt.max}
						oninput={() => (whenDirty = true)}
					/>
				</div>
				<div class="field">
					<label for="note">Note</label>
					<input id="note" name="note" maxlength="200" placeholder="Optional" />
				</div>
				<button class="button" type="submit">Log it</button>
			</form>
			<p class="muted hint">
				A negative amount corrects an over-log. Missed a day? Move the time back and the entry lands
				in that orbit instead.
			</p>
		</section>
	{/if}

	<section class="panel block">
		<h2>Recent orbits</h2>
		<OrbitHistory history={data.snapshot.history} color={goal.color} />
	</section>

	<section class="panel block" id="entries">
		<h2>Entries</h2>
		{#if data.recentEntries.length === 0}
			<p class="muted">Nothing logged yet. The first entry starts the orbit.</p>
		{:else}
			<ul class="entries">
				{#each data.recentEntries as entry (entry.id)}
					<li class:entries__row--editing={editing === entry.id}>
						{#if editing === entry.id && !archived}
							<form class="edit" method="POST" action="?/editEntry&edit={entry.id}" use:enhance>
								<input type="hidden" name="entryId" value={entry.id} />
								<div class="field">
									<label for="amount-{entry.id}">Amount</label>
									<input
										id="amount-{entry.id}"
										name="amount"
										type="number"
										step="any"
										defaultValue={entry.amount}
										required
									/>
								</div>
								<div class="field">
									<label for="when-{entry.id}">When</label>
									<input
										id="when-{entry.id}"
										name="occurredAt"
										type="datetime-local"
										defaultValue={toLocalDateTime(entry.occurredAt, data.timeZone)}
										min={data.occurredAt.min}
										max={data.occurredAt.max}
									/>
								</div>
								<div class="field">
									<label for="note-{entry.id}">Note</label>
									<input
										id="note-{entry.id}"
										name="note"
										maxlength="200"
										defaultValue={entry.note ?? ''}
										placeholder="Optional"
									/>
								</div>
								<div class="edit__actions">
									<button class="button" type="submit">Save entry</button>
									<a class="button button--ghost" href="{goalHref}#entries">Cancel</a>
								</div>
							</form>
						{:else}
							<span class="entry__amount">{formatAmount(entry.amount, goal.metric)}</span>
							<span class="muted entry__when">{dateFormatter.format(entry.occurredAt)}</span>
							{#if entry.note}<span class="entry__note muted">{entry.note}</span>{/if}
							{#if !archived}
								<span class="entry__actions">
									<a class="link-button" href="{goalHref}?edit={entry.id}#entries">Edit</a>
									<form method="POST" action="?/deleteEntry" use:enhance>
										<input type="hidden" name="entryId" value={entry.id} />
										<button class="link-button" type="submit" aria-label="Delete entry">
											Remove
										</button>
									</form>
								</span>
							{/if}
						{/if}
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

	.notice {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
	}

	.notice ul {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		padding-left: 1.1rem;
	}

	.confirm h2 {
		font-size: 1.05rem;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: 0.9rem;
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
		align-items: center;
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
		grid-template-columns: 0.8fr 1.1fr 1.2fr auto;
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

	.entries__row--editing {
		grid-template-columns: 1fr;
	}

	.entry__amount {
		color: var(--text-bright);
		font-weight: 620;
	}

	.entry__when,
	.entry__note {
		font-size: 0.88rem;
	}

	.entry__actions {
		align-items: center;
		display: flex;
		gap: 0.35rem;
	}

	.edit {
		align-items: end;
		display: grid;
		gap: 0.75rem;
		grid-template-columns: 0.8fr 1.1fr 1.2fr auto;
		padding: 0.35rem 0 0.6rem;
		width: 100%;
	}

	.edit__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
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
		color: var(--text-bright);
		text-decoration: none;
	}

	form .link-button:hover {
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

		.custom,
		.edit {
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
