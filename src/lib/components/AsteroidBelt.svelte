<script lang="ts">
	import AsteroidRow from '$components/AsteroidRow.svelte';
	import FieldError from '$components/FieldError.svelte';
	import Asteroid from '$components/Asteroid.svelte';
	import AsteroidSheet from '$components/AsteroidSheet.svelte';
	import { atBeltEdge, doneLabel, type Asteroid as AsteroidData } from '$domain/asteroids';
	import { describedBy, type FormErrors } from '$domain/validation';
	import { resolve } from '$app/paths';

	/**
	 * The belt: what you do with ten spare minutes and nothing due.
	 *
	 * Its own band below the orbits rather than a case inside `TodayFocus`,
	 * because an asteroid is not a goal — it produces no snapshot, closes no
	 * period and touches no streak, so there is nothing for the focus split to
	 * rank it against.
	 *
	 * Deliberately not gated on being non-empty the way the folds above it are.
	 * A fold with nothing in it has somewhere else to be filled from; this band
	 * is the only place an asteroid can be added, so hiding it when the belt is
	 * clear would make the first one impossible to add.
	 */

	/** What the clearing action says about the title it just cleared. */
	interface CaptureOfferPrompt {
		asteroidId: string;
		title: string;
		count: number;
	}

	interface Props {
		asteroids: readonly AsteroidData[];
		/** Compact opens a sheet where the default density expands in place. */
		compact?: boolean;
		/** Recently finished, newest first — bounded by the service. */
		done?: readonly AsteroidData[];
		now: Date;
		errors?: FormErrors | null;
		/** What just happened, for the belt's own live region. */
		message?: string | null;
		offer?: CaptureOfferPrompt | null;
		addAction: string;
		clearAction: string;
		releaseAction: string;
		editAction: string;
		dismissAction: string;
	}

	let {
		asteroids,
		compact = false,
		done = [],
		now,
		errors = null,
		message = null,
		offer = null,
		addAction,
		clearAction,
		releaseAction,
		editAction,
		dismissAction
	}: Props = $props();

	const newGoalHref = resolve('/goals/new');

	/**
	 * Which rock's sheet a compact row asked to open, if any. An id rather than
	 * the asteroid itself, so the sheet keeps reading the current row — the
	 * list is reloaded on every action, and a held object would go stale the
	 * moment one was edited from inside the sheet.
	 *
	 * The dialog lives here rather than in the row for the reason #51 found
	 * with goals: a `<dialog>` keeps its place in the top layer only while its
	 * own element stays put, and a row's element does not. This band is drawn
	 * once and never moves.
	 */
	let openId = $state<string | null>(null);
	const openAsteroid = $derived(asteroids.find((rock) => rock.id === openId) ?? null);
	/** How many rocks have drifted as far as the belt goes. */
	const atEdge = $derived(asteroids.filter((rock) => atBeltEdge(rock, now)).length);
</script>

<section class="belt" id="belt" aria-labelledby="belt-heading">
	<h2 id="belt-heading">
		The belt{#if asteroids.length > 0}&nbsp;({asteroids.length}){/if}
	</h2>
	<!--
		The explanation, only while there is nothing to explain it against. Four
		rocks on the belt say what a belt is better than three lines of prose
		above them do, and on a phone those three lines cost more than the rock
		they describe.
	-->
	{#if asteroids.length === 0}
		<p class="muted lede">
			One-offs that never became a cycle — no tier, no target, no streak. Tick one off when nothing
			is due, or let it go.
		</p>
	{/if}

	{#if atEdge > 0}
		<!-- Said once, by the band, rather than once per rock. What it is saying
		     is that letting go is an ending, not a verdict — and a sentence
		     repeated down a list stops reading that way by the third time. -->
		<p class="muted lede">
			{atEdge === 1 ? 'One is' : `${atEdge} are`} out at the edge. Letting one go is as good an ending
			as finishing it.
		</p>
	{/if}

	<form class="add" method="POST" action={addAction}>
		<label class="visually-hidden" for="asteroid-title">Add a one-off</label>
		<input
			id="asteroid-title"
			name="title"
			maxlength="80"
			placeholder="Something with no cadence…"
			required
			{...describedBy(errors?.title, 'asteroid-title')}
		/>
		<button class="button" type="submit">Add</button>
	</form>
	<FieldError id="asteroid-title" message={errors?.title} />

	<!--
		The belt's own status line rather than the page's. The one above belongs
		to closing orbits, which is the loudest thing that happens here, and a
		cleared asteroid must never share a channel with it.
	-->
	<p class="live" role="status">{message ?? ''}</p>

	{#if offer}
		<!--
			Offered on the clear, where somebody is already looking at "done" —
			never on the add, which would interrupt a two-tap capture with a
			decision, and never as a banner that appears unprompted.
		-->
		<div class="offer">
			<p class="offer__text">
				<strong>{offer.title}</strong> has cleared {offer.count} times. Something that keeps coming back
				is a cadence Nova could hold for you.
			</p>
			<div class="offer__actions">
				<a class="button" href="{newGoalHref}?asteroid={offer.asteroidId}">Make it a goal</a>
				<form method="POST" action={dismissAction}>
					<input type="hidden" name="id" value={offer.asteroidId} />
					<button class="button button--ghost" type="submit">No, it is a one-off</button>
				</form>
			</div>
		</div>
	{/if}

	{#if asteroids.length > 0}
		<ul class="rocks">
			{#each asteroids as asteroid (asteroid.id)}
				<AsteroidRow
					{asteroid}
					{now}
					{clearAction}
					{releaseAction}
					{editAction}
					onopen={compact ? (id) => (openId = id) : undefined}
				/>
			{/each}
		</ul>
	{:else}
		<p class="muted empty">Nothing adrift.</p>
	{/if}

	<!--
		Only while there is something to show, which is where this parts company
		with `GoalRowSheet`. That one is permanent because the row it belongs to
		is not: a goal moving between sections used to destroy its dialog
		mid-flight and cost it the top layer (#51). Nothing here moves — the band
		is drawn once — so the dialog can be built when it opens and taken away
		when it closes, and the Today view is left carrying one dialog rather
		than two, including at the default density, where this one can never open
		at all.
	-->
	{#if openAsteroid}
		<AsteroidSheet
			asteroid={openAsteroid}
			{now}
			{clearAction}
			{editAction}
			{releaseAction}
			onclose={() => (openId = null)}
		/>
	{/if}

	{#if done.length > 0}
		<!--
			What settled back into the belt. The same `<details>` the folds above
			this band use, for the same reason: it is worth keeping and not worth
			the room, and the element already maps to a disclosure that announces
			its own state.

			Bounded, and deliberately so — an endless list of finished one-offs is
			the same infinite ledger drift exists to prevent, only flattering
			instead of reproachful. Released asteroids are in no list at all.
		-->
		<details class="fold">
			<summary>Done ({done.length})</summary>
			<ul class="rocks rocks--done">
				{#each done as asteroid (asteroid.id)}
					<li class="settled">
						<Asteroid seed={asteroid.id} drift={0} band="fresh" settled />
						<span class="settled__title">{asteroid.title}</span>
						<span class="settled__when muted">{doneLabel(asteroid, now)}</span>
					</li>
				{/each}
			</ul>
			<p class="muted fold__note">
				Back in the belt, and drifting from nothing. The most recent stay here.
			</p>
		</details>
	{/if}
</section>

<style>
	.belt {
		display: grid;
		gap: 0.4rem;
	}

	h2 {
		font-size: 1.05rem;
		margin: 0;
	}

	.lede {
		font-size: var(--text-secondary);
		margin: 0;
		max-width: 60ch;
	}

	.add {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}

	.add input {
		flex: 1 1 auto;
		min-width: 0;
	}

	.add .button {
		flex: none;
		padding: 0.55rem 1.1rem;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--text-dim);
		font-size: var(--text-secondary);
		margin: 0;
	}

	/*
	 * The one moment the belt raises its voice, and it still does not raise it
	 * far: a bordered note, no gradient, no burst. Closing an orbit is the
	 * biggest thing that happens in Nova and nothing here may compete with it.
	 */
	.offer {
		border: 1px solid var(--space-border-bright);
		border-radius: var(--radius);
		display: grid;
		gap: 0.6rem;
		margin: 0.2rem 0;
		padding: 0.75rem 0.9rem;
	}

	.offer__text {
		margin: 0;
		max-width: 60ch;
	}

	.offer__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.rocks {
		display: grid;
		gap: var(--gap-list);
		list-style: none;
		margin: 0.25rem 0 0;
		padding: 0;
	}

	:global(html[data-density='compact']) .rocks {
		gap: 0.35rem;
	}

	.empty {
		font-size: var(--text-secondary);
		margin: 0.2rem 0 0;
	}

	/* The same fold the bands above this one use. */
	.fold {
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		margin-top: 0.35rem;
		padding: 0.1rem 0.9rem;
	}

	summary {
		color: var(--text-dim);
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap-min);
		padding: 0.68rem 0;
	}

	.rocks--done {
		/* The fold's marks are smaller than a row's: a finished one-off is a
		   line, not a card. */
		--mark-width: 56px;

		gap: 0.15rem;
		margin: 0 0 0.5rem;
	}

	:global(html[data-density='compact']) .rocks--done {
		--mark-width: 44px;
	}

	/*
	 * Mark, title, then when — the when beside the title rather than flung out
	 * to the right margin, where a short title and its date stop looking like
	 * one line.
	 */
	.settled {
		align-items: center;
		display: grid;
		gap: 0 0.55rem;
		grid-template-columns: auto auto minmax(0, 1fr);
	}

	/*
	 * Not struck through. A finished one-off is not a crossed-out line in a
	 * list, it is a rock that made it back — and the drawing beside it already
	 * says which of the two this is.
	 */
	.settled__title {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.settled__when {
		font-size: var(--text-secondary);
		white-space: nowrap;
	}

	.fold__note {
		font-size: var(--text-secondary);
		margin: 0 0 0.7rem;
		max-width: 60ch;
	}
</style>
