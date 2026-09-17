<script lang="ts">
	import { resolve } from '$app/paths';
	import OrbitDial from '$components/OrbitDial.svelte';
	import { celebrationFor } from '$lib/celebration.svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import { formatAmount } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { CADENCE_LABEL } from '$domain/tiers';
	import { pendingFor } from '$lib/offline/queue.svelte';

	/**
	 * One goal as a row, for compact density.
	 *
	 * Compact used to be the same card with less padding around it, which bought
	 * about thirty pixels a goal — the card's shape was the floor, not its
	 * spacing. This is the shape change: a ring, a title and what is left, at
	 * roughly a quarter of the height, with the quick-log moved into a sheet the
	 * row opens rather than dropped.
	 *
	 * The sheet itself lives one level up, in `GoalRowSheet` — not here. A
	 * `<dialog>` is only promoted to the browser's top layer while its own
	 * element stays put, and a row's element does not stay put: it lives inside
	 * a keyed `{#each}`, and a goal moving between sections (closing, most
	 * notably — see #51) is a destroy and a create however the lists are drawn.
	 * Moving the dialog with it broke exactly that promotion, so the row only
	 * asks to open a goal; the page holds the one sheet that answers.
	 *
	 * The dial follows the same convention it does everywhere else — decorative,
	 * with `orbitStanding()` beside it — and that text lands inside the row's own
	 * link along with the title and the status. No `label` is passed: the title
	 * is already in the same name, and repeating it would have the row announce
	 * the goal twice before saying anything about it.
	 */

	interface Props {
		snapshot: GoalSnapshot;
		/** A word about why this row is here, e.g. `Behind pace`. */
		flag?: string;
		/**
		 * Asked to open this goal's sheet. Left out — no JavaScript, or a
		 * modified click — and the row is a plain link to the goal page, which
		 * does the same job a screen further on.
		 */
		onopen?: (goalId: string) => void;
	}

	let { snapshot, flag, onopen }: Props = $props();

	const goal = $derived(snapshot.goal);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	/** Orbits rather than minutes or pages, once this goal has children. */
	const metric = $derived(metricFor(snapshot));
	const closing = $derived(celebrationFor(goal.id) !== null);
	/**
	 * Entries this goal is still carrying. The row has no `aria-label`, so this
	 * lands in its accessible name with everything else on the line — compact
	 * density says pending out loud rather than only tinting a dial.
	 */
	const waiting = $derived(pendingFor(goal.id));

	/**
	 * The row is a link to the goal, and the sheet is the enhancement on top of
	 * it. Without JavaScript — or without `<dialog>` — the click is left alone
	 * and the goal page does the same job a screen further on.
	 */
	function openSheet(event: MouseEvent) {
		if (!onopen) return;
		if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
		// Let a modified click open the goal page in its own tab, as a link should.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		onopen(goal.id);
	}
</script>

<a class="row panel" href={goalHref} onclick={openSheet}>
	<OrbitDial
		orbit={snapshot.current}
		tier={goal.tier}
		color={goal.color}
		size={52}
		goalId={goal.id}
		satellites={snapshot.derived?.children ?? []}
	/>

	<span class="body">
		<span class="title">{goal.title}</span>
		<span class="status muted">
			{#if snapshot.current.complete}
				Orbit closed {CADENCE_LABEL[snapshot.current.period.cadence]}
				<span aria-hidden="true">✦</span>
			{:else}
				{formatAmount(snapshot.current.remaining, metric)} left {CADENCE_LABEL[
					snapshot.current.period.cadence
				]}
			{/if}
		</span>
	</span>

	{#if waiting > 0}
		<span class="pending">
			<span class="pending__dot" aria-hidden="true"></span>
			{waiting}
			<span class="visually-hidden">{waiting === 1 ? 'entry' : 'entries'}</span> waiting
			<span class="visually-hidden">to sync</span>
		</span>
	{/if}

	{#if flag}<span class="flag">{flag}</span>{/if}

	{#if snapshot.streak > 0}
		<span class="streak" class:streak--ticked={closing}>
			<span aria-hidden="true">✦</span>
			{snapshot.streak}
			<span class="visually-hidden">orbit streak</span>
		</span>
	{/if}
</a>

<style>
	.row {
		align-items: center;
		box-shadow: none;
		color: var(--text);
		display: grid;
		gap: 0 0.7rem;
		/* Dial, body, then a column each for pending, the flag and the streak —
		   all three optional, and the row stays one line with any of them. */
		grid-template-columns: auto minmax(0, 1fr) auto auto auto;
		/* Comfortably over the touch floor at the row's natural height. */
		min-height: var(--tap-min);
		padding: 0.4rem 0.7rem;
	}

	.row:hover {
		border-color: var(--space-border-bright);
		text-decoration: none;
	}

	.body {
		display: grid;
		gap: 0.05rem;
		min-width: 0;
	}

	/* One line each: a row that wraps is a row that has stopped being one. */
	.title,
	.status {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.title {
		color: var(--text-bright);
		font-weight: 600;
	}

	.status {
		font-size: var(--text-secondary);
	}

	.flag {
		border: 1px solid currentColor;
		border-radius: 999px;
		color: var(--accent-warm);
		font-size: var(--text-label);
		font-weight: 640;
		letter-spacing: 0.06em;
		padding: 0.1rem 0.45rem;
		text-transform: uppercase;
		white-space: nowrap;
	}

	/* The same words the card uses, at the width a row can spare. */
	.pending {
		align-items: center;
		color: var(--accent-warm);
		display: inline-flex;
		font-size: var(--text-label);
		font-weight: 640;
		gap: 0.3rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.pending__dot {
		animation: breathe 1.8s ease-in-out infinite;
		background: currentColor;
		border-radius: 50%;
		flex: none;
		height: 0.4rem;
		width: 0.4rem;
	}

	@keyframes breathe {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	.streak {
		color: var(--accent-warm);
		font-size: var(--text-secondary);
		font-weight: 640;
		white-space: nowrap;
	}

	/* The streak does not just change, it lands — the same beat the card uses. */
	.streak--ticked {
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
</style>
