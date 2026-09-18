<script lang="ts">
	import Asteroid from '$components/Asteroid.svelte';
	import AsteroidDetails from '$components/AsteroidDetails.svelte';
	import {
		driftBand,
		driftFraction,
		driftLabel,
		type Asteroid as AsteroidData
	} from '$domain/asteroids';

	/**
	 * The sheet a compact belt row opens, held by the band rather than the row.
	 *
	 * The same lesson #51 learned with goals: a `<dialog>` is promoted to the
	 * browser's top layer only while its own element stays where it is in the
	 * document, and a row's element does not stay put — it lives in a keyed
	 * `{#each}`, and a rock that is finished or let go is destroyed and rebuilt
	 * elsewhere. A dialog that moved with it would lose its promotion mid-move
	 * and render flat in the page. `AsteroidBelt` is drawn once and never moves,
	 * so it is where this lives; a row only asks to open an asteroid by id.
	 */

	interface Props {
		/** The asteroid to show. Closes the dialog when null. */
		asteroid: AsteroidData | null;
		/** The request's clock, for the drift line in the header. */
		now: Date;
		/** `?/…` paths on the page that owns the band. */
		clearAction: string;
		editAction: string;
		releaseAction: string;
		/** Asked to clear whichever asteroid this was showing. */
		onclose?: () => void;
	}

	let { asteroid, now, clearAction, editAction, releaseAction, onclose }: Props = $props();

	let dialog: HTMLDialogElement | null = $state(null);

	/**
	 * Opens and closes to match `asteroid` rather than being told to directly —
	 * the band sets it from the id a row asked to open and clears it once the
	 * dialog's own `close` event says the sheet is done, whichever end that came
	 * from: the button below, Escape, or the backdrop.
	 */
	$effect(() => {
		if (!dialog) return;
		if (asteroid && !dialog.open) dialog.showModal();
		if (!asteroid && dialog.open) dialog.close();
	});

	/** A click that lands on the dialog itself landed on its backdrop. */
	function maybeDismiss(event: MouseEvent) {
		if (event.target === dialog) dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-label={asteroid ? `${asteroid.title} — details` : undefined}
	onclose={() => onclose?.()}
	onclick={maybeDismiss}
>
	{#if asteroid}
		<div class="sheet__inner">
			<header class="head">
				<Asteroid
					seed={asteroid.id}
					drift={driftFraction(asteroid, now)}
					band={driftBand(asteroid, now)}
				/>
				<div class="head__words">
					<h2>{asteroid.title}</h2>
					<p class="muted">{driftLabel(asteroid, now)}</p>
				</div>
			</header>

			<AsteroidDetails {asteroid} {clearAction} {editAction} {releaseAction} idPrefix="sheet-" />

			<button class="button button--ghost close" type="button" onclick={() => dialog?.close()}>
				Close
			</button>
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

	.sheet__inner {
		backdrop-filter: blur(16px);
		background: var(--space-surface-strong);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-lift);
		display: grid;
		gap: 0.5rem;
		min-height: 0;
		/* Clear of the home indicator. A sheet long enough to need it scrolls
		   inside itself rather than running off the bottom of the screen. */
		overflow-y: auto;
		padding: 0.85rem 0.85rem calc(0.85rem + env(safe-area-inset-bottom));
	}

	/* The rock again, at the size a heading can carry — so the sheet is
	   recognisably about the row that opened it. */
	.head {
		align-items: center;
		display: flex;
		gap: 0.6rem;
		min-width: 0;
		--mark-width: 76px;
	}

	.head__words {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}

	h2 {
		font-size: 1.05rem;
		margin: 0;
		overflow-wrap: anywhere;
	}

	.head__words p {
		font-size: var(--text-secondary);
		margin: 0;
	}

	.close {
		justify-self: start;
		margin-top: 0.3rem;
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

		.sheet__inner {
			border-radius: var(--radius-lg);
		}
	}
</style>
