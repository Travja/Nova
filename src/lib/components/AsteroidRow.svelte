<script lang="ts">
	import Asteroid from '$components/Asteroid.svelte';
	import {
		driftBand,
		driftFraction,
		driftLabel,
		offersRelease,
		type LabelStyle
	} from '$domain/asteroids';
	import type { Asteroid as AsteroidData } from '$domain/asteroids';
	import { resolve } from '$app/paths';

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
	 * The title gets a line to itself and the drift shares one with the two
	 * endings, which is what keeps a phone row to two lines: the endings carry
	 * the touch floor, so any line they are on is 44px whatever else is there —
	 * and a line doing nothing but holding two buttons is the most expensive
	 * kind of line a row can have. Sharing it with the drift makes that height
	 * pay for two things instead of one.
	 *
	 * No breakpoint anywhere. When the drift is too long to share, it wraps of
	 * its own accord, which is a question about this title at this density in
	 * this window — something the layout knows and a media query does not.
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
	}

	let { asteroid, now, labels = 'long', clearAction, releaseAction, editAction }: Props = $props();

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
	const adrift = $derived(offersRelease(asteroid, now) && labels === 'long');
	/** Inlined into the attribute below rather than pre-joined, so the resolve
	    rule can see the route it is built from — the same shape the history
	    pager and the archive confirmation use. */
	const newGoalHref = resolve('/goals/new');
</script>

<li class="rock panel" data-band={band}>
	<Asteroid seed={asteroid.id} {drift} {band} />

	<div class="body">
		<p class="title">{asteroid.title}</p>

		<div class="line">
			<!-- The separators are non-breaking on purpose: the space before a `·`
			     sits at the start of an inline element, where ordinary whitespace
			     is trimmed away and the dot ends up welded to the word before it. -->
			<p class="meta muted">
				{driftLabel(asteroid, now, labels)}{#if adrift}<span class="edge">&nbsp;· at the edge</span
					>{/if}{#if asteroid.note}<span class="note">&nbsp;· {asteroid.note}</span>{/if}
			</p>

			<div class="actions">
				<form method="POST" action={clearAction}>
					<input type="hidden" name="id" value={asteroid.id} />
					<button class="tap act act--done" type="submit">
						<span aria-hidden="true">✓</span> Done<span class="visually-hidden">
							{asteroid.title}</span
						>
					</button>
				</form>
				<form method="POST" action={releaseAction}>
					<input type="hidden" name="id" value={asteroid.id} />
					<button class="tap act" type="submit">
						Release<span class="visually-hidden"> {asteroid.title}</span>
					</button>
				</form>
			</div>
		</div>
	</div>

	<details class="tweak">
		<summary>Edit</summary>
		<form class="edit" method="POST" action={editAction}>
			<input type="hidden" name="id" value={asteroid.id} />
			<label class="visually-hidden" for="title-{asteroid.id}">Title</label>
			<input id="title-{asteroid.id}" name="title" value={asteroid.title} maxlength="80" required />
			<label class="visually-hidden" for="note-{asteroid.id}">Note</label>
			<input
				id="note-{asteroid.id}"
				name="note"
				value={asteroid.note ?? ''}
				maxlength="500"
				placeholder="A note, if it needs one"
			/>
			<button class="button button--ghost" type="submit">Save</button>
		</form>
		<p class="muted hint">
			Rewriting the title starts the drift again — a different rock is a different age. Amending the
			note leaves the clock where it is.
		</p>
		<!--
			Available from the moment the rock exists, per decision #1, so it
			cannot claim the rock keeps coming back — on the first one that is
			simply untrue. The offer that has actually counted says so in its own
			words; this one only offers.
		-->
		<a class="tap promote" href="{newGoalHref}?asteroid={asteroid.id}">Make this a goal instead</a>
	</details>
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
		grid-template-areas:
			'mark body'
			'mark foot';
		grid-template-columns: auto minmax(0, 1fr);
		padding: 0.45rem 0.7rem;
	}

	/*
	 * The mark takes the row's whole height rather than a fixed slice of the
	 * top of it, which is what lets the belt run the length of the card. The
	 * rock inside it stays vertically centred whatever the row grows to.
	 */
	.rock > :global(.asteroid) {
		align-self: stretch;
		grid-area: mark;
	}

	.body {
		display: grid;
		gap: 0.05rem;
		grid-area: body;
		min-width: 0;
	}

	/* The drift and the two endings, sharing the line the endings pay for. */
	.line {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
		min-width: 0;
	}

	/* Enough to say how long it has been out there; it gives up the rest of a
	   long form before it pushes the endings onto a line of their own. */
	.meta {
		flex: 1 1 6rem;
	}

	/* To the end of the line they share, or to the start of their own. */
	.actions {
		margin-left: auto;
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

	.tweak {
		grid-area: foot;
	}

	/*
	 * Both endings at the same weight. Neither is a `.button`: the belt is the
	 * band you reach for when nothing is due, and two gradient pills per row
	 * would out-shout the orbits above it.
	 */
	.act {
		background: transparent;
		border: 1px solid var(--space-border);
		border-radius: 999px;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		gap: 0.3rem;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
	}

	.act:hover {
		border-color: var(--space-border-bright);
		color: var(--text-bright);
	}

	/* Finishing is the likelier of the two, so it is the one that is lit. */
	.act--done {
		color: var(--text-bright);
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

	.edit {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.25rem 0 0;
	}

	.edit input {
		flex: 1 1 10rem;
		min-width: 0;
	}

	.edit .button {
		flex: none;
		font-size: var(--text-secondary);
		padding: 0.35rem 1rem;
	}

	.hint {
		font-size: var(--text-label);
		margin: 0.3rem 0 0;
		max-width: 60ch;
	}

	.promote {
		color: var(--accent);
		display: inline-flex;
		font-size: var(--text-secondary);
		justify-content: flex-start;
	}

	/*
	 * Compact is a different shape, not the same one with less padding — the
	 * same move the goal row makes. The mark comes down, the row gives up the
	 * padding it was using to breathe, and the endings sit beside a drift that
	 * has been cut to its number. Two lines on a phone, against the four the
	 * default density wants.
	 */
	:global(html[data-density='compact']) .rock {
		--mark-width: 52px;
		padding: 0.25rem 0.55rem;
	}

	:global(html[data-density='compact']) .body {
		gap: 0;
	}

	:global(html[data-density='compact']) .line {
		gap: 0.1rem 0.5rem;
	}

	:global(html[data-density='compact']) .act {
		font-size: var(--text-label);
		letter-spacing: 0.02em;
		padding: 0.15rem 0.55rem;
	}

	:global(html[data-density='compact']) .tweak {
		font-size: var(--text-label);
	}

	:global(html[data-density='compact']) summary {
		padding: 0;
	}
</style>
