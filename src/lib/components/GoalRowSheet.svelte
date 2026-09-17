<script lang="ts">
	import GoalSheet from '$components/GoalSheet.svelte';
	import type { GoalSnapshot } from '$domain/progress';

	/**
	 * The sheet a compact `GoalRow` opens, lifted out of the row itself (#51).
	 *
	 * A `<dialog>` is promoted to the browser's top layer only while its own
	 * element stays where it is in the document. Living inside a `GoalRow` used
	 * to break that the moment the goal closed: `focusForToday` moves a closed
	 * goal to a different keyed `{#each}`, Svelte destroys the row's element to
	 * build a fresh one elsewhere, and the dialog — mid-move — lost its
	 * promotion and rendered flat in the page instead of over it.
	 *
	 * One sheet per page, outside every `{#each}` a row lives in, sidesteps
	 * that entirely: nothing about this element ever moves. A row only asks to
	 * open a goal by id; the page holds that id and hands this component the
	 * matching snapshot, looked up fresh from the same list the rows are drawn
	 * from, so the sheet keeps reading the goal's current state — closing,
	 * closed, whatever comes after — without needing to live inside it.
	 */

	interface Props {
		/** The goal to show. Closes the dialog when null. */
		snapshot: GoalSnapshot | null;
		/** Where the sheet's quick-log posts. Passed straight through. */
		logAction?: string;
		/** Asked to clear whichever goal this was showing. */
		onclose?: () => void;
	}

	let { snapshot, logAction, onclose }: Props = $props();

	let dialog: HTMLDialogElement | null = $state(null);

	/**
	 * Opens and closes to match `snapshot` rather than being told to directly —
	 * the page sets `snapshot` from the goal id a row asked to open, and clears
	 * it once the dialog's own `close` event says the sheet is done, whichever
	 * end that came from (a tap on Close, Escape, or the backdrop below).
	 */
	$effect(() => {
		if (!dialog) return;
		if (snapshot && !dialog.open) dialog.showModal();
		if (!snapshot && dialog.open) dialog.close();
	});

	/** A click that lands on the dialog itself landed on its backdrop. */
	function maybeDismiss(event: MouseEvent) {
		if (event.target === dialog) dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-label={snapshot ? `${snapshot.goal.title} — log and details` : undefined}
	onclose={() => onclose?.()}
	onclick={maybeDismiss}
>
	{#if snapshot}
		<div class="sheet__inner">
			<GoalSheet {snapshot} {logAction} onclose={() => dialog?.close()} />
		</div>
	{/if}
</dialog>

<style>
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
