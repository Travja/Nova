<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ChildOrbits from '$components/ChildOrbits.svelte';
	import FieldError from '$components/FieldError.svelte';
	import OrbitDial from '$components/OrbitDial.svelte';
	import OrbitHistory from '$components/OrbitHistory.svelte';
	import { celebrationFor, noteOrbits } from '$lib/celebration.svelte';
	import { toLocalDateTime } from '$domain/period';
	import { formatAmount, quickLogSteps } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import { overlayQueued } from '$domain/queue';
	import { describedBy } from '$domain/validation';
	import { logOrQueue, type QueuedState } from '$lib/offline/enhance';
	import { queuedEntries } from '$lib/offline/queue.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * The server's snapshot with anything still in the offline queue folded in,
	 * so the dial on this page reads the same as the card that queued the entry.
	 * `overlayQueued` is the domain's own maths over plain data — the point of
	 * keeping `$domain` free of server imports.
	 */
	const snapshot = $derived(
		overlayQueued(data.snapshot, queuedEntries(), {
			timeZone: data.timeZone,
			weekStartsOn: data.user?.weekStartsOn
		})
	);
	const goal = $derived(snapshot.goal);
	const current = $derived(snapshot.current);
	const archived = $derived(goal.archivedAt !== null);
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	/**
	 * A goal with children counts closed child orbits, so every amount on this
	 * page is in orbits. `metricFor` is the one place that decides it.
	 */
	const metric = $derived(metricFor(snapshot));
	const nested = $derived(snapshot.derived ?? null);
	const steps = $derived(quickLogSteps(metric, goal.target));
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	/**
	 * Which entry the list is editing. The URL drives it so the row survives a
	 * submit without JavaScript; a saved edit closes it again.
	 */
	const editing = $derived(form?.edited ? null : data.editing);

	let confirmingDelete = $state(false);
	/** Set when a log went to the offline queue instead of to the server. */
	let queued = $state<QueuedState | null>(null);

	/**
	 * Both log forms here go through the queue, and this one carries a `When`,
	 * so it hands over the zone: a `datetime-local` is wall-clock time in the
	 * user's own zone, and reading it in the browser's would file a backdated
	 * entry under the wrong orbit for anybody travelling.
	 */
	function logSubmit(after?: () => void): SubmitFunction {
		return (input) =>
			logOrQueue({
				goalId: goal.id,
				timeZone: data.timeZone,
				onqueued: (_entry, state) => {
					queued = state;
					after?.();
				},
				onresult: async ({ update }) => {
					queued = null;
					await update();
					after?.();
				}
			})(input);
	}

	/**
	 * Every log re-renders this page, so the closing has to be spotted by
	 * comparing what the browser saw last. Effects do not run on the server, so a
	 * closed orbit that arrives in the first render is history, not a moment.
	 */
	$effect(() => noteOrbits([snapshot]));
	const closing = $derived(celebrationFor(goal.id) !== null);

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

	/** Which entry a row's Edit and Remove are about, for their names. */
	function entryName(entry: { amount: number; occurredAt: Date }): string {
		return `${formatAmount(entry.amount, goal.metric)} on ${dateFormatter.format(entry.occurredAt)}`;
	}

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
			size={200}
			caption="{formatAmount(current.logged, metric)} / {formatAmount(goal.target, metric)}"
			goalId={goal.id}
			satellites={nested?.children ?? []}
		/>

		<div class="hero__copy">
			<p class="tier-tag" style="color: {tierDef.accent}">
				{tierDef.label} · one orbit per {current.period.cadence}{nested ? ' · derived' : ''}
			</p>
			<h1>{goal.title}</h1>
			{#if goal.description}<p class="muted">{goal.description}</p>{/if}

			<p class="status">
				{#if archived}
					Archived — this is the orbit it stopped on.
				{:else if current.complete}
					Orbit closed {CADENCE_LABEL[current.period.cadence]} — {formatAmount(
						current.logged,
						metric
					)}{nested ? ' closed underneath it' : ' logged'}.
				{:else}
					{formatAmount(current.remaining, metric)} to go {CADENCE_LABEL[current.period.cadence]}.
				{/if}
			</p>

			<dl class="stats">
				<div>
					<dt>{archived ? 'Streak when archived' : 'Streak'}</dt>
					<dd class:dd--ticked={closing}>{snapshot.streak}</dd>
				</div>
				<div>
					<dt>Orbits closed</dt>
					<dd>{snapshot.totalOrbits}</dd>
				</div>
				<div>
					<dt>{nested ? 'Orbits fed in' : 'Lifetime'}</dt>
					<dd>{formatAmount(snapshot.lifetimeLogged, metric)}</dd>
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
			is still here.
			{#if snapshot.streak > 0}
				Its streak is frozen rather than broken — restore it and it carries on from {snapshot.streak}
				{snapshot.streak === 1 ? 'orbit' : 'orbits'}.
			{:else}
				Nothing it misses while parked counts against it.
			{/if}
		</p>
	{:else if data.confirmingArchive}
		<section class="notice panel confirm">
			<h2>Archive {goal.title}?</h2>
			<ul>
				<li>Every entry stays exactly where it is.</li>
				<li>The goal leaves the dashboard and stops asking for progress.</li>
				<li>
					{#if snapshot.streak > 0}
						The streak freezes at {snapshot.streak} rather than breaking — the periods it spends archived
						are not counted as missed.
					{:else}
						Periods it spends archived are never counted as missed, so a streak picks up where it
						left off.
					{/if}
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

	{#if nested}
		<section class="panel block">
			<h2>What feeds this orbit</h2>
			<p class="muted">
				This goal counts the orbits its children close, so nothing is logged against it directly. A
				child period that falls short counts nothing and one that overshoots counts once — the orbit
				here measures how many of them you closed, not how much you did.
			</p>
			<ChildOrbits children={nested.children} orbit={current} />
			{#if data.recentEntries.length > 0}
				<p class="muted hint">
					The entries below were logged before this goal had children. They are still here and still
					yours, but they no longer move this orbit.
				</p>
			{/if}
		</section>
	{:else if !archived}
		<section class="panel block">
			<h2>Log progress</h2>

			{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

			<p class="live" role="status">
				{#if queued === 'stored'}
					Saved on this device — it will sync when you are back online.
				{:else if queued === 'unstored'}
					Logged — this browser will not keep it if you reload.
				{:else if queued === 'logged'}
					Logged.
				{:else}{orbitMessage}{/if}
			</p>

			<form class="quick" method="POST" action="?/log" use:enhance={logSubmit()}>
				{#each steps as step (step)}
					<button class="chip tap" type="submit" name="amount" value={step}>
						+{formatAmount(step, goal.metric)}
					</button>
				{/each}
			</form>

			<form
				class="custom"
				method="POST"
				action="?/log"
				use:enhance={logSubmit(() => {
					whenDirty = false;
					syncWhen();
				})}
			>
				<div class="field">
					<label for="amount">
						Amount {#if goal.metric.kind === 'duration'}<span class="muted">(minutes)</span>{/if}
					</label>
					<input
						id="amount"
						name="amount"
						type="number"
						step="any"
						required
						{...describedBy(form?.errors?.amount, 'amount')}
					/>
					<FieldError id="amount" message={form?.errors?.amount} />
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
						{...describedBy(form?.errors?.occurredAt, 'occurredAt')}
					/>
					<FieldError id="occurredAt" message={form?.errors?.occurredAt} />
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
		<OrbitHistory history={snapshot.history} tier={goal.tier} goalId={goal.id} color={goal.color} />
	</section>

	<section class="panel block" id="entries">
		<h2>Entries</h2>
		{#if data.recentEntries.length === 0}
			<p class="muted">Nothing logged yet. The first entry starts the orbit.</p>
		{:else}
			<ul class="entries">
				{#each data.recentEntries as entry (entry.id)}
					<li class:entries__row--editing={editing === entry.id}>
						{#if editing === entry.id && !archived && !nested}
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
							{#if !archived && !nested}
								<span class="entry__actions">
									<!-- Every row carried the same two names, so a screen reader read a
									     list of "Edit, Remove, Edit, Remove" with nothing to say which
									     entry each belonged to. The entry itself is the distinguisher. -->
									<a class="link-button tap" href="{goalHref}?edit={entry.id}#entries">
										Edit <span class="visually-hidden">{entryName(entry)}</span>
									</a>
									<form method="POST" action="?/deleteEntry" use:enhance>
										<input type="hidden" name="entryId" value={entry.id} />
										<button class="link-button tap" type="submit">
											Remove <span class="visually-hidden">{entryName(entry)}</span>
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
		gap: var(--gap-view);
	}

	.hero {
		align-items: center;
		display: grid;
		gap: var(--gap-card);
		grid-template-columns: auto 1fr;
		padding: var(--pad-hero);
	}

	.hero__copy {
		display: grid;
		gap: var(--gap-block);
	}

	.tier-tag {
		font-size: var(--text-secondary);
		font-weight: 640;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.status {
		color: var(--text-bright);
	}

	.notice {
		display: grid;
		gap: var(--gap-block);
		padding: var(--pad-panel);
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
		font-size: var(--text-secondary);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.15rem;
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
		font-size: 1.1rem;
		font-weight: 640;
		margin: 0;
	}

	/* The streak does not just change, it lands. */
	.dd--ticked {
		animation: tick 620ms cubic-bezier(0.22, 1, 0.36, 1);
		color: var(--success);
		display: inline-block;
	}

	@keyframes tick {
		0% {
			transform: translateY(0.35em) scale(0.9);
		}
		55% {
			transform: translateY(-0.12em) scale(1.12);
		}
		100% {
			transform: translateY(0) scale(1);
		}
	}

	.hero__actions {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.block {
		display: grid;
		gap: var(--gap-block);
		padding: var(--pad-panel);
	}

	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	/* Sized by `.tap`, like the chips on a card — this is the same control. */
	.chip {
		background: rgba(10, 14, 36, 0.8);
		border: 1px solid var(--space-border);
		border-radius: 999px;
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
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
		font-size: var(--text-secondary);
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
		gap: 0.6rem;
		grid-template-columns: auto auto 1fr auto;
		padding: 0.1rem 0;
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
		font-size: var(--text-secondary);
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

	/*
	 * Edit and Remove sit in a row rather than in a sentence, so they are
	 * controls and take the floor — which is most of why an entry row is the
	 * height it is. Shrinking the row is not worth a target you miss.
	 */
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
