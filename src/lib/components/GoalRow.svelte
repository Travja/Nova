<script lang="ts">
	import { resolve } from '$app/paths';
	import GoalSheet from '$components/GoalSheet.svelte';
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
	 * The sheet is the same `GoalCard` the default density draws, with the custom
	 * amount and the goal's details around it — so the row gives up its chips to
	 * something that carries more than the card it replaced, not less.
	 *
	 * No `role="progressbar"` here, unlike the card: the dial is presentational
	 * and #7 asks for an equivalent text node beside it, which is exactly what
	 * the status line is. A second telling would only muddy the row's name, and
	 * the sheet carries the precise figure anyway.
	 */

	interface Props {
		snapshot: GoalSnapshot;
		/** Where the sheet's quick-log posts. Passed straight through. */
		logAction?: string;
		/** A word about why this row is here, e.g. `Behind pace`. */
		flag?: string;
	}

	let { snapshot, logAction, flag }: Props = $props();

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

	let sheet: HTMLDialogElement | null = $state(null);
	/**
	 * The card is only built while the sheet is up. A closed `<dialog>` still
	 * holds its contents, and a screen of rows each keeping a hidden dial turning
	 * is a lot of animation nobody is looking at.
	 */
	let open = $state(false);

	/**
	 * The row is a link to the goal, and the sheet is the enhancement on top of
	 * it. Without JavaScript — or without `<dialog>` — the click is left alone
	 * and the goal page does the same job a screen further on.
	 */
	function openSheet(event: MouseEvent) {
		if (!sheet || typeof sheet.showModal !== 'function') return;
		// Let a modified click open the goal page in its own tab, as a link should.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		open = true;
		sheet.showModal();
	}

	/** A click that lands on the dialog itself landed on its backdrop. */
	function maybeDismiss(event: MouseEvent) {
		if (event.target === sheet) sheet?.close();
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
				Orbit closed {CADENCE_LABEL[snapshot.current.period.cadence]} ✦
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

<dialog bind:this={sheet} class="sheet" onclose={() => (open = false)} onclick={maybeDismiss}>
	{#if open}
		<div class="sheet__inner">
			<GoalSheet {snapshot} {logAction} onclose={() => sheet?.close()} />
		</div>
	{/if}
</dialog>

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

	/*
	 * A sheet off the bottom of the screen, which is where the thumb that opened
	 * it already is. `<dialog>` brings the focus trap, the escape key and the
	 * inertness of everything behind it, none of which is worth reimplementing.
	 */
	.sheet {
		background: transparent;
		border: none;
		/* A column so the body below can take the leftover height and scroll in
		   it, rather than running off the bottom of a long sheet. */
		display: flex;
		flex-direction: column;
		margin: auto auto 0;
		max-height: 92%;
		max-width: 32rem;
		overflow: visible;
		padding: 0;
		width: 100%;
	}

	.sheet::backdrop {
		backdrop-filter: blur(2px);
		background: rgba(4, 5, 13, 0.66);
	}

	/*
	 * The sheet's own ground. Without it the card floats and everything around
	 * it — the custom amount, the facts, the history — is read straight off the
	 * blurred page behind the backdrop.
	 */
	.sheet__inner {
		backdrop-filter: blur(16px);
		background: var(--space-surface-strong);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-lift);
		min-height: 0;
		/* Clear of the home indicator. A sheet long enough to need it scrolls
		   inside itself rather than running off the bottom of the screen. */
		overflow-y: auto;
		padding: 0.85rem 0.85rem calc(0.85rem + env(safe-area-inset-bottom));
	}

	.sheet[open] {
		animation: rise 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes rise {
		from {
			transform: translateY(1.5rem);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (min-width: 34rem) {
		.sheet {
			margin: auto;
		}

		/* Centred rather than risen from the bottom edge, so it is a card on all
		   four sides. */
		.sheet__inner {
			border-radius: var(--radius-lg);
		}
	}
</style>
