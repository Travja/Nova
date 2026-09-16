<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ChildOrbits from '$components/ChildOrbits.svelte';
	import GoalCard from '$components/GoalCard.svelte';
	import OrbitHistory from '$components/OrbitHistory.svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import { formatAmount } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import { describedBy, errorId } from '$domain/validation';
	import { logOrQueue, type QueuedState } from '$lib/offline/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * What a compact row opens: the full card, plus the things the card has no
	 * room to carry on a list.
	 *
	 * The chips cover the amounts you log most, and the sheet is where the one
	 * that is not on a chip goes — seven pages rather than five, ten or twenty —
	 * so the row giving up its quick-log costs nothing at all. The rest is the
	 * detail a list drops: what the goal is for, what a full orbit asks, and how
	 * the last few went.
	 *
	 * Lives apart from `GoalRow` because the row is a row and this is a screen;
	 * keeping them in one file made it hard to see where either began.
	 */

	interface Props {
		snapshot: GoalSnapshot;
		/** Where both the chips and the custom amount post. */
		logAction?: string;
		/** Asked to shut, once there is nothing left to do here. */
		onclose?: () => void;
	}

	let { snapshot, logAction = `${resolve('/')}?/log`, onclose }: Props = $props();

	const goal = $derived(snapshot.goal);
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	/** Orbits rather than the goal's own metric, once it has children. */
	const metric = $derived(metricFor(snapshot));
	const nested = $derived(snapshot.derived ?? null);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	/** Enough to read the run of form at a glance, not the whole year. */
	const recent = $derived(snapshot.history.slice(0, 8));

	let amount = $state('');
	let note = $state('');
	let error = $state('');
	let pending = $state(false);

	let queued = $state<QueuedState | null>(null);

	function clear() {
		error = '';
		amount = '';
		note = '';
	}

	/**
	 * The sheet stays put either way. A failure has to be readable here rather
	 * than in the page's live region behind the backdrop, and a success refreshes
	 * the page underneath so the dial in this very sheet sweeps round to its new
	 * reading.
	 *
	 * Offline it goes to the queue instead, and the sheet says so where it says
	 * everything else — the card behind it is already drawing the entry.
	 */
	const logCustom: SubmitFunction = (input) =>
		logOrQueue({
			goalId: goal.id,
			onbusy: (busy) => (pending = busy),
			onqueued: (_entry, state) => {
				clear();
				queued = state;
			},
			onresult: async ({ result, update }) => {
				if (result.type === 'failure') {
					const errors = (result.data as { errors?: Record<string, string> } | undefined)?.errors;
					error = errors?.amount ?? errors?.form ?? 'That did not log.';
					return;
				}

				clear();
				queued = null;
				await update({ reset: false });
			}
		})(input);
</script>

<div class="sheet__body">
	<GoalCard {snapshot} {logAction} />

	{#if nested}
		<ChildOrbits children={nested.children} orbit={snapshot.current} />
	{:else}
		<form class="custom" method="POST" action={logAction} use:enhance={logCustom}>
			<input type="hidden" name="goalId" value={goal.id} />

			<div class="field">
				<label for="sheet-amount-{goal.id}">
					Amount {#if metric.kind === 'duration'}<span class="muted">(minutes)</span>{/if}
				</label>
				<input
					id="sheet-amount-{goal.id}"
					name="amount"
					type="number"
					step="any"
					inputmode="decimal"
					bind:value={amount}
					required
					{...describedBy(error, `sheet-amount-${goal.id}`)}
				/>
			</div>

			<div class="field">
				<label for="sheet-note-{goal.id}">Note</label>
				<input
					id="sheet-note-{goal.id}"
					name="note"
					maxlength="200"
					placeholder="Optional"
					bind:value={note}
				/>
			</div>

			<button class="button" type="submit" disabled={pending}>Log it</button>
		</form>

		<!-- `role="alert"` rather than `<FieldError>`: the sheet never navigates
		     and the input keeps focus, so nothing else would announce this. -->
		<p id={errorId(`sheet-amount-${goal.id}`)} class="error" role="alert">{error}</p>
		{#if queued}
			<p class="queued" role="status">
				{#if queued === 'stored'}
					Saved on this device — it will sync when you are back online.
				{:else if queued === 'unstored'}
					Logged — this browser will not keep it if you reload.
				{:else}
					Logged.
				{/if}
			</p>
		{/if}
	{/if}

	<dl class="facts">
		<div>
			<dt>Tier</dt>
			<dd style="color: {tierDef.accent}">
				{tierDef.label} · one orbit per {snapshot.current.period.cadence}
			</dd>
		</div>
		<div>
			<dt>A full orbit</dt>
			<dd>{formatAmount(goal.target, metric)}</dd>
		</div>
		<div>
			<dt>{nested ? 'Orbits fed in' : 'Logged in all'}</dt>
			<dd>{formatAmount(snapshot.lifetimeLogged, metric)}</dd>
		</div>
	</dl>

	{#if goal.description}
		<p class="muted description">{goal.description}</p>
	{/if}

	{#if recent.length > 0}
		<div class="recent">
			<h3>Recent orbits</h3>
			<OrbitHistory history={recent} tier={goal.tier} goalId={goal.id} color={goal.color} />
		</div>
	{/if}

	<div class="actions">
		<a class="button button--ghost" href={goalHref}>Open goal</a>
		<button class="button button--ghost" type="button" onclick={() => onclose?.()}>Close</button>
	</div>
</div>

<style>
	.sheet__body {
		display: grid;
		gap: var(--gap-block);
	}

	/*
	 * One row on anything but the narrowest phone: an amount, a note nobody has
	 * to fill in, and the button. Backdating is not here on purpose — that is a
	 * decision with a calendar attached, and it belongs on the goal's own page.
	 */
	.custom {
		align-items: end;
		display: grid;
		gap: 0.5rem;
		grid-template-columns: minmax(5rem, 0.7fr) minmax(0, 1.3fr) auto;
	}

	.error:empty {
		display: none;
	}

	.queued {
		color: var(--accent-warm);
		font-size: var(--text-secondary);
		margin: 0;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.1rem;
		margin: 0;
	}

	.facts div {
		display: grid;
		gap: 0.05rem;
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

	.description {
		font-size: var(--text-secondary);
		margin: 0;
	}

	.recent {
		display: grid;
		gap: 0.3rem;
	}

	.recent h3 {
		color: var(--text-dim);
		font-size: var(--text-label);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.actions {
		display: grid;
		gap: 0.5rem;
		grid-template-columns: 1fr 1fr;
	}

	/* At the very bottom of the range the three-up form has to stack. */
	@media (max-width: 22rem) {
		.custom {
			grid-template-columns: 1fr;
		}
	}
</style>
