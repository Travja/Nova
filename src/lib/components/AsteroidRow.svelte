<script lang="ts">
	import Asteroid from '$components/Asteroid.svelte';
	import AsteroidDetails from '$components/AsteroidDetails.svelte';
	import {
		atBeltEdge,
		driftBand,
		driftFraction,
		driftLabel,
		offersRelease,
		type LabelStyle
	} from '$domain/asteroids';
	import type { Asteroid as AsteroidData } from '$domain/asteroids';

	/**
	 * One rock on the belt: what it is, how long it has been out there, and the
	 * three ways it can leave.
	 *
	 * Finishing and releasing sit side by side and are drawn at the same weight
	 * on purpose. Releasing is a legitimate ending, not a failure — the whole
	 * point of drift is that the belt never becomes a ledger of things not done
	 * — so nothing here dresses one of them up as the right answer.
	 *
	 * The button says Done and the state it writes is still called `cleared`:
	 * the three terminal states are settled vocabulary the export in #17 is
	 * scoped against, and what a person reads is a different question.
	 *
	 * Two lines, and both of them earn their height. The endings carry the touch
	 * floor, so whichever line they are on is 44px tall whatever else is there —
	 * which makes a line holding nothing but buttons the most expensive kind a
	 * row can have. So they share the title's line, and the drift shares the
	 * next one with the disclosure. Marks rather than words is what bought that:
	 * two labelled pills took most of a phone row, two circles take 88px.
	 *
	 * No breakpoint anywhere. Anything that will not fit wraps of its own
	 * accord, which is a question about this title at this density in this
	 * window — something the layout knows and a media query does not.
	 */

	interface Props {
		asteroid: AsteroidData;
		/** The request's clock, so every rock is measured against one instant. */
		now: Date;
		/**
		 * How much room the drift has. Compact hands this `short` — the branch is
		 * here rather than in CSS because it changes the words, not their size,
		 * and it is server-rendered either way so hydration has nothing to
		 * disagree about.
		 */
		labels?: LabelStyle;
		/** `?/…` paths on the page that owns this row. */
		clearAction: string;
		releaseAction: string;
		editAction: string;
		/**
		 * Asked to open this asteroid's sheet, which compact rows do instead of
		 * expanding in place. Left out — the default density, no JavaScript, or
		 * no `<dialog>` — and the disclosure below opens the ordinary way.
		 */
		onopen?: (id: string) => void;
	}

	let {
		asteroid,
		now,
		labels = 'long',
		clearAction,
		releaseAction,
		editAction,
		onopen
	}: Props = $props();

	/**
	 * The disclosure is the enhancement's own fallback. Its contents are in the
	 * page either way, so a browser that cannot open the sheet — no JavaScript,
	 * no `<dialog>` — still has every one of them a tap away, which is what the
	 * belt promises about letting a one-off go.
	 */
	function openSheet(event: MouseEvent) {
		if (!onopen) return;
		if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
		event.preventDefault();
		onopen(asteroid.id);
	}

	const band = $derived(driftBand(asteroid, now));
	const drift = $derived(driftFraction(asteroid, now));
	/**
	 * Whether this rock has drifted as far as the belt goes.
	 *
	 * Only said in words where there is room for the words. Compact drops the
	 * tag rather than truncating it: the band above the list already says how
	 * many are out at the edge, and the rock's own distance from the swarm says
	 * which ones — so the row is repeating something twice said, and "at the
	 * e…" is worse than either.
	 */
	const adrift = $derived(atBeltEdge(asteroid, now) && labels === 'long');
	/**
	 * Whether letting go is one of the row's own controls yet. While it is not,
	 * it is still one tap inside the disclosure below — hidden from the row, not
	 * taken away.
	 */
	const canRelease = $derived(offersRelease(asteroid, now));
</script>

<li class="rock panel" data-band={band}>
	<Asteroid seed={asteroid.id} {drift} {band} />

	<div class="body">
		<div class="line line--top">
			<p class="title">{asteroid.title}</p>
			<!--
				Marks rather than words. Two labelled pills is most of a phone row's
				width for something a thumb knows by shape after the first day, and
				the arrow points the way the rock is already drifting. The name each
				one answers to is still a full sentence — it is just carried by the
				accessible name and the tooltip instead of by pixels.
			-->
			<div class="actions">
				<form method="POST" action={clearAction}>
					<input type="hidden" name="id" value={asteroid.id} />
					<button class="tap act act--done" type="submit" title="Done">
						<span aria-hidden="true">✓</span>
						<span class="visually-hidden">Done {asteroid.title}</span>
					</button>
				</form>
				{#if canRelease}
					<form method="POST" action={releaseAction}>
						<input type="hidden" name="id" value={asteroid.id} />
						<button class="tap act" type="submit" title="Release — let this one go">
							<span aria-hidden="true">↗</span>
							<span class="visually-hidden">Release {asteroid.title}</span>
						</button>
					</form>
				{/if}
			</div>
		</div>

		<div class="line line--under">
			<!-- The separators are non-breaking on purpose: the space before a `·`
			     sits at the start of an inline element, where ordinary whitespace
			     is trimmed away and the dot ends up welded to the word before it. -->
			<p class="meta muted">
				{driftLabel(asteroid, now, labels)}{#if adrift}<span class="edge">&nbsp;· at the edge</span
					>{/if}{#if asteroid.note}<span class="note">&nbsp;· {asteroid.note}</span>{/if}
			</p>

			<details class="tweak">
				<summary onclick={openSheet}>
					More<span class="visually-hidden"> about {asteroid.title}</span>
				</summary>
				<AsteroidDetails {asteroid} {editAction} {releaseAction} />
			</details>
		</div>
	</div>
</li>

<style>
	/*
	 * Two columns and no breakpoint. The mark runs the height of the card; the
	 * body holds everything else and decides for itself how many lines that
	 * takes. The disclosure sits under the body rather than under the mark, so
	 * it lines up with the title it belongs to.
	 */
	.rock {
		align-items: center;
		display: grid;
		gap: 0 0.7rem;
		grid-template-columns: auto minmax(0, 1fr);
		padding: 0.35rem 0.7rem;
	}

	/*
	 * The mark takes the row's whole height rather than a fixed slice of the
	 * top of it, which is what lets the belt run the length of the card. The
	 * rock inside it stays vertically centred whatever the row grows to.
	 */
	.rock > :global(.asteroid) {
		align-self: stretch;
	}

	.body {
		display: grid;
		gap: 0;
		min-width: 0;
	}

	.line {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		min-width: 0;
	}

	/* The endings sit against the title, so this line is as tall as they are
	   and the title is free inside it. */
	.line--top {
		gap: 0.2rem 0.5rem;
		min-height: var(--tap-min);
	}

	/* Everything quiet, on one short line under it. */
	.line--under {
		gap: 0 0.7rem;
	}

	.title {
		flex: 1 1 6rem;
	}

	.meta {
		flex: 0 1 auto;
	}

	/* To the end of the line they share, or to the start of their own. */
	.actions {
		margin-left: auto;
	}

	/*
	 * The disclosure is a flex item on the quiet line while it is shut, and
	 * takes a line of its own the moment it opens — a panel of form fields has
	 * no business being as wide as the word "Edit".
	 */
	.tweak[open] {
		flex-basis: 100%;
	}

	.title {
		color: var(--text-bright);
		font-weight: 600;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		font-size: var(--text-secondary);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A rock nobody has touched says so more quietly, not more loudly. */
	.rock[data-band='drifting'] .title {
		color: var(--text);
	}

	.rock[data-band='faint'] .title {
		color: var(--text);
		opacity: 0.82;
	}

	.actions {
		display: flex;
		flex: none;
		gap: 0.3rem;
	}

	/*
	 * A mark apiece, round, at the touch floor and no wider. Neither is a
	 * `.button`: the belt is the band you reach for when nothing is due, and two
	 * gradient pills per row would out-shout the orbits above it.
	 *
	 * Square at `--tap-min` rather than padded to it, so the two of them take
	 * 88px of a phone row instead of the 130 the words took — which is what
	 * bought the drift a place on the same line.
	 */
	.act {
		background: transparent;
		border: 1px solid var(--space-border);
		border-radius: 50%;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: 1rem;
		height: var(--tap-min);
		line-height: 1;
		padding: 0;
		width: var(--tap-min);
	}

	.act:hover {
		border-color: var(--space-border-bright);
		color: var(--text-bright);
	}

	/* Finishing is the likelier of the two, so it is the one that is lit. */
	.act--done {
		color: var(--text-bright);
		font-size: 1.05rem;
	}

	.act--done:hover {
		border-color: var(--success);
		color: var(--success);
	}

	/*
	 * Three words rather than a sentence, and the same three on every rock that
	 * has got this far. What being at the edge means is said once by the band
	 * above — repeating it per row is how a belt turns back into a list of
	 * reproaches.
	 */
	.edge {
		color: var(--text);
	}

	.tweak {
		font-size: var(--text-secondary);
	}

	summary {
		color: var(--text-dim);
		cursor: pointer;
		/* Well under `--tap-min`: this is a text link in a muted line, and giving
		   it the full floor would put a 44px gap in the middle of every row. The
		   two endings above it are the targets a thumb is aiming for. */
		padding: 0.2rem 0;
		width: max-content;
	}

	summary:hover {
		color: var(--text);
	}

	/*
	 * Compact is a different shape, not the same one with less padding — the
	 * same move the goal row makes. The mark comes down, the row gives up the
	 * padding it was using to breathe, and the endings sit beside a drift that
	 * has been cut to its number. Two lines on a phone, against the four the
	 * default density wants.
	 */
	:global(html[data-density='compact']) .rock {
		--mark-width: 48px;
		padding: 0.2rem 0.55rem;
	}

	:global(html[data-density='compact']) .tweak {
		font-size: var(--text-label);
	}

	:global(html[data-density='compact']) summary {
		padding: 0;
	}
</style>
