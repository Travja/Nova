<script lang="ts">
	import Asteroid from '$components/Asteroid.svelte';
	import { driftBand, driftFraction, driftLabel, offersRelease } from '$domain/asteroids';
	import type { Asteroid as AsteroidData } from '$domain/asteroids';
	import { resolve } from '$app/paths';

	/**
	 * One rock on the belt: what it is, how long it has been out there, and the
	 * three ways it can leave.
	 *
	 * Clearing and releasing sit side by side and are drawn at the same weight
	 * on purpose. Releasing is a legitimate ending, not a failure — the whole
	 * point of drift is that the belt never becomes a ledger of things not done
	 * — so nothing here dresses one of them up as the right answer.
	 */

	interface Props {
		asteroid: AsteroidData;
		/** The request's clock, so every rock is measured against one instant. */
		now: Date;
		/** `?/…` paths on the page that owns this row. */
		clearAction: string;
		releaseAction: string;
		editAction: string;
	}

	let { asteroid, now, clearAction, releaseAction, editAction }: Props = $props();

	const band = $derived(driftBand(asteroid, now));
	const drift = $derived(driftFraction(asteroid, now));
	const adrift = $derived(offersRelease(asteroid, now));
	/** Inlined into the attribute below rather than pre-joined, so the resolve
	    rule can see the route it is built from — the same shape the history
	    pager and the archive confirmation use. */
	const newGoalHref = resolve('/goals/new');
</script>

<li class="rock panel" data-band={band}>
	<Asteroid seed={asteroid.id} {drift} {band} />

	<div class="body">
		<p class="title">{asteroid.title}</p>
		<!-- The separators are non-breaking on purpose: the space before a `·`
		     sits at the start of an inline element, where ordinary whitespace is
		     trimmed away and the dot ends up welded to the word before it. -->
		<p class="meta muted">
			{driftLabel(asteroid, now)}{#if adrift}<span class="edge">&nbsp;· at the edge</span
				>{/if}{#if asteroid.note}<span class="note">&nbsp;· {asteroid.note}</span>{/if}
		</p>
	</div>

	<div class="actions">
		<form method="POST" action={clearAction}>
			<input type="hidden" name="id" value={asteroid.id} />
			<button class="tap act act--clear" type="submit">
				<span aria-hidden="true">✓</span> Clear<span class="visually-hidden">
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

	<div class="foot">
		<details class="tweak">
			<summary>Edit</summary>
			<form class="edit" method="POST" action={editAction}>
				<input type="hidden" name="id" value={asteroid.id} />
				<label class="visually-hidden" for="title-{asteroid.id}">Title</label>
				<input
					id="title-{asteroid.id}"
					name="title"
					value={asteroid.title}
					maxlength="80"
					required
				/>
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
				Rewriting the title starts the drift again — a different rock is a different age. Amending
				the note leaves the clock where it is.
			</p>
			<a class="tap promote" href="{newGoalHref}?asteroid={asteroid.id}">
				This keeps coming back — make it a goal
			</a>
		</details>
	</div>
</li>

<style>
	.rock {
		align-items: center;
		display: grid;
		gap: 0.15rem 0.7rem;
		grid-template-areas:
			'mark body actions'
			'mark foot foot';
		grid-template-columns: auto minmax(0, 1fr) auto;
		padding: 0.5rem 0.7rem;
	}

	/*
	 * The mark sits at the top of its column rather than centred, so a row that
	 * grows — an open edit panel, a release offer — does not send the rock
	 * sliding down the middle of it.
	 */
	.rock > :global(.asteroid) {
		align-self: start;
		grid-area: mark;
	}

	.body {
		grid-area: body;
		min-width: 0;
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
		gap: 0.3rem;
		grid-area: actions;
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

	/* Clearing is the likelier of the two, so it is the one that is lit. */
	.act--clear {
		color: var(--text-bright);
	}

	.act--clear:hover {
		border-color: var(--success);
		color: var(--success);
	}

	.foot {
		display: grid;
		gap: 0.2rem;
		grid-area: foot;
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

	@media (max-width: 30rem) {
		/*
		 * Narrow enough that the two endings want a line of their own. They take
		 * the full width rather than staying in the body's column: indented
		 * under the rock they read as belonging to the title above them, and a
		 * thumb has less to aim at for no reason.
		 */
		.rock {
			grid-template-areas:
				'mark body'
				'actions actions'
				'foot foot';
		}

		.actions {
			margin-top: 0.35rem;
		}
	}
</style>
