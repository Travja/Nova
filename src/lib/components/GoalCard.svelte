<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import OrbitDial from '$components/OrbitDial.svelte';
	import { celebrationFor } from '$lib/celebration.svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import { formatAmount, quickLogSteps } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import { logOrQueue } from '$lib/offline/enhance';
	import { pendingFor } from '$lib/offline/queue.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		snapshot: GoalSnapshot;
		/** Set while a log request for this goal is in flight. */
		pending?: boolean;
		/**
		 * Where the quick-log form posts. Each screen owns its own `log` action so
		 * a card logs without navigating away from the page it is drawn on.
		 */
		logAction?: string;
	}

	let { snapshot, pending = false, logAction = `${resolve('/')}?/log` }: Props = $props();

	const goal = $derived(snapshot.goal);
	const goalHref = $derived(resolve('/goals/[id]', { id: goal.id }));
	const tierDef = $derived(TIER_DEFINITIONS[goal.tier]);
	const steps = $derived(quickLogSteps(goal.metric, goal.target));
	/** True for the second or so after this goal closes an orbit. */
	const closing = $derived(celebrationFor(goal.id) !== null);
	/**
	 * Entries logged against this goal that the server has not seen yet. The
	 * dial above already counts them — the page overlays the queue onto the
	 * snapshot before it draws — so this says why it reads high, rather than
	 * leaving a number that disagrees with the server unexplained.
	 */
	const waiting = $derived(pendingFor(goal.id));

	/**
	 * Logs against the server when it can and into the offline queue when it
	 * cannot. Built per submission so it reads the goal this card is drawing
	 * now, rather than the one it was drawing when the action was set up.
	 */
	const logSubmit: SubmitFunction = (input) => logOrQueue({ goalId: goal.id })(input);
</script>

<article class="card panel" class:card--complete={snapshot.current.complete}>
	<!-- Named by what is inside it rather than by an `aria-label`, which would
	     take the dial's own text equivalent out of the reading and leave the
	     card's largest element saying nothing at all. `label` gives the dial the
	     goal it is drawing, so the link lands as "Daily reading, Satellite: 62%
	     of target logged" rather than as a percentage attached to nothing. -->
	<a class="dial-link" href={goalHref}>
		<OrbitDial
			orbit={snapshot.current}
			tier={goal.tier}
			color={goal.color}
			size={120}
			goalId={goal.id}
			label={goal.title}
		/>
	</a>

	<div class="body">
		<!-- The title and the line under it are one target rather than a 20px-tall
		     link sitting on top of a 46px block. Costs no height and is what a
		     thumb was aiming at anyway.

		     Named for the goal rather than by its contents: left to the contents
		     the link announces itself as "Daily reading 5 pages left today",
		     which is the status read twice — it is also the text of the line
		     below — and leaves the card with no link a screen reader can pick
		     out by the goal's name. -->
		<a class="heading" href={goalHref} aria-label={goal.title}>
			<h3>{goal.title}</h3>
			<p class="muted status">
				{#if snapshot.current.complete}
					Orbit closed {CADENCE_LABEL[snapshot.current.period.cadence]}
					<span aria-hidden="true">✦</span>
				{:else}
					{formatAmount(snapshot.current.remaining, goal.metric)} left {CADENCE_LABEL[
						snapshot.current.period.cadence
					]}
				{/if}
			</p>
		</a>

		<!-- Outside the heading link on purpose: that link names itself after the
		     goal, and an `aria-label` takes everything inside it out of the
		     reading. Pending has to be text in the card's own flow to be heard
		     at all, and the live region in `OfflineQueue` announces the change. -->
		{#if waiting > 0}
			<p class="pending">
				<span class="pending__dot" aria-hidden="true"></span>
				{waiting}
				{waiting === 1 ? 'entry' : 'entries'} waiting to sync
			</p>
		{/if}

		<dl class="stats">
			<div>
				<dt>Streak</dt>
				<dd class:dd--ticked={closing}>{snapshot.streak}</dd>
			</div>
			<div>
				<dt>Orbits</dt>
				<dd>{snapshot.totalOrbits}</dd>
			</div>
			<div class="stat--tier">
				<dt>Tier</dt>
				<dd style="color: {tierDef.accent}">{tierDef.label}</dd>
			</div>
		</dl>
	</div>

	<form class="quick-log" method="POST" action={logAction} use:enhance={logSubmit}>
		<input type="hidden" name="goalId" value={goal.id} />
		{#each steps as step (step)}
			<button class="chip tap" type="submit" name="amount" value={step} disabled={pending}>
				+{formatAmount(step, goal.metric)}
			</button>
		{/each}
		<a class="chip chip--ghost tap" href={goalHref}>More…</a>
	</form>
</article>

<style>
	/*
	 * Dial beside body, quick-log on its own row beneath. The chips carry a
	 * unit — `+13 reps` — so they need the width: penned into the body column
	 * they wrap onto three rows on a phone and cost more height than the dial
	 * they were sharing a line with.
	 */
	.card {
		align-items: center;
		column-gap: var(--gap-card);
		display: grid;
		grid-template-areas:
			'dial body'
			'dial log';
		grid-template-columns: auto 1fr;
		padding: var(--pad-card);
		row-gap: var(--gap-block);
		transition: border-color 200ms ease;
	}

	.dial-link {
		align-self: center;
		grid-area: dial;
	}

	.quick-log {
		grid-area: log;
	}

	.card--complete {
		border-color: var(--space-border-bright);
	}

	.dial-link:hover {
		text-decoration: none;
	}

	.body {
		display: grid;
		gap: var(--gap-block);
		grid-area: body;
		min-width: 0;
	}

	.heading {
		display: block;
		min-height: var(--tap-min);
	}

	.heading:hover {
		text-decoration: none;
	}

	.heading h3 {
		color: var(--text-bright);
		font-size: 1.1rem;
	}

	.heading:hover h3 {
		text-decoration: underline;
	}

	.status {
		font-size: var(--text-secondary);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.9rem;
		margin: 0;
	}

	.stats div {
		display: grid;
		gap: 0.1rem;
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

	/*
	 * Pending is a state, not a decoration: the words carry it and the dot is
	 * `aria-hidden` next to them. The pulse yields to `prefers-reduced-motion`
	 * with everything else, handled globally in `app.css`, which is why the
	 * colour has to say it too.
	 */
	.pending {
		align-items: center;
		color: var(--accent-warm);
		display: flex;
		font-size: var(--text-secondary);
		gap: 0.4rem;
		margin: 0;
	}

	.pending__dot {
		animation: breathe 1.8s ease-in-out infinite;
		background: currentColor;
		border-radius: 50%;
		flex: none;
		height: 0.5rem;
		width: 0.5rem;
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

	/* The streak does not just change, it lands. */
	.dd--ticked {
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

	.quick-log {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	/*
	 * The most-tapped control in the app, and the one #32 was most at risk of
	 * shrinking: `.tap` holds it at 44px square in both densities. Everything
	 * density does to this card, it does around the chips.
	 */
	.chip {
		background: rgba(10, 14, 36, 0.8);
		border: 1px solid var(--space-border);
		border-radius: 999px;
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		padding: 0.3rem 0.6rem;
		transition:
			border-color 160ms ease,
			transform 160ms ease;
	}

	.chip:hover {
		border-color: var(--space-border-bright);
		text-decoration: none;
	}

	.chip:active {
		transform: translateY(1px);
	}

	.chip--ghost {
		color: var(--text-dim);
	}

	/*
	 * A phone keeps the dial beside the body rather than stacking above it.
	 * Stacked and centred was the scaffold's idea of narrow and it cost about
	 * 180px a card — roughly half of what fits on a 390px screen. Side by side
	 * with a smaller dial is the single biggest thing #32 buys back.
	 */
	@media (max-width: 34rem) {
		.card {
			grid-template-areas:
				'dial body'
				'log log';
		}

		/*
		 * Three chips and a unit fill the row on a phone, so `More…` wrapped
		 * onto a second 44px row of its own — a whole row for a third link to
		 * the page the title and the dial both already open. The custom-amount
		 * form is one tap away either way.
		 */
		.chip--ghost {
			display: none;
		}

		.heading h3 {
			font-size: 1.05rem;
		}

		/* Both screens that draw these cards already name the tier around them —
		   a pill above the card on Today, a section heading on the dashboard —
		   and on a phone this copy of it is the width of a whole stat. */
		.stats .stat--tier {
			display: none;
		}
	}
</style>
