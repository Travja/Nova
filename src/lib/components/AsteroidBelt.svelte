<script lang="ts">
	import AsteroidRow from '$components/AsteroidRow.svelte';
	import FieldError from '$components/FieldError.svelte';
	import { offersRelease, type Asteroid } from '$domain/asteroids';
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
		asteroids: readonly Asteroid[];
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
	/** How many rocks have drifted as far as the belt goes. */
	const atEdge = $derived(asteroids.filter((rock) => offersRelease(rock, now)).length);
</script>

<section class="belt" aria-labelledby="belt-heading">
	<h2 id="belt-heading">
		The belt{#if asteroids.length > 0}&nbsp;({asteroids.length}){/if}
	</h2>
	<p class="muted lede">
		One-offs that never became a cycle — no tier, no target, no streak. Clear one when nothing is
		due, or let it go.
	</p>

	{#if atEdge > 0}
		<!-- Said once, by the band, rather than once per rock. What it is saying
		     is that letting go is an ending, not a verdict — and a sentence
		     repeated down a list stops reading that way by the third time. -->
		<p class="muted lede">
			{atEdge === 1 ? 'One of these has' : `${atEdge} of these have`} drifted as far as the belt goes.
			Letting one go is as good an ending as clearing it.
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
				<AsteroidRow {asteroid} {now} {clearAction} {releaseAction} {editAction} />
			{/each}
		</ul>
	{:else}
		<p class="muted empty">Nothing adrift.</p>
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
</style>
