<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import { mascotFor } from '$domain/mascot';
	import { formatAmount, formatTimeLeft, type TodayFocus } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { celebration } from '$lib/celebration.svelte';
	import { onMount } from 'svelte';

	/**
	 * The pilot, reacting to the week.
	 *
	 * The mood comes from `mascotFor`, which reads the same split the focused
	 * view is drawn from, so the drawing and the list can never disagree. The
	 * copy is warm on purpose: a missed orbit is information, not a telling-off.
	 */
	interface Props {
		focus: TodayFocus;
		/** The instant the orbits were measured against. */
		now: Date;
		size?: number;
	}

	let { focus, now, size = 160 }: Props = $props();

	const pilot = $derived(mascotFor(focus));
	const subject = $derived(pilot.subject);
	const closing = $derived(celebration());

	const timeLeft = $derived(subject ? formatTimeLeft(subject.current.period, now) : '');
	const remaining = $derived(
		subject ? formatAmount(subject.current.remaining, metricFor(subject)) : ''
	);
	/** "today" or "the week": what is running out, in the sentence it appears in. */
	const runningOut = $derived.by(() => {
		const cadence = subject?.current.period.cadence;
		if (!cadence) return 'the period';
		return cadence === 'day' ? 'today' : `the ${cadence}`;
	});

	/**
	 * Skippable for anyone who finds it distracting. The preference lives in this
	 * browser until #14 puts it on the account with the rest of them, so reading
	 * it waits for the client rather than tearing hydration apart.
	 */
	const STORAGE_KEY = 'nova:mascot-hidden';
	let hidden = $state(false);

	onMount(() => {
		try {
			hidden = localStorage.getItem(STORAGE_KEY) === '1';
		} catch {
			// A private window can refuse storage; the pilot simply stays.
		}
	});

	function setHidden(value: boolean) {
		hidden = value;
		try {
			localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
		} catch {
			// Nothing to fall back to, and nothing that breaks without it.
		}
	}
</script>

{#if hidden}
	<p class="recall">
		<button class="link-button" type="button" onclick={() => setHidden(false)}>
			Bring the pilot back
		</button>
	</p>
{:else}
	<section class="mascot panel" data-mood={pilot.mood} style="--size: {size}px">
		<Astronaut {size} mood={pilot.mood} cheer={closing !== null} />

		<div class="copy">
			{#if closing}
				<h2>{closing.title} closed its orbit ✦</h2>
				<p class="muted">That is one more revolution on the board.</p>
			{:else if pilot.mood === 'resting'}
				<h2>{pilot.closed > 0 ? 'Nothing owed' : 'Nothing in flight'}</h2>
				<p class="muted">
					{#if pilot.closed > 0}
						{pilot.closed}
						{pilot.closed === 1 ? 'orbit is' : 'orbits are'} closed and nothing else is asking for you.
						The next one comes round on its own.
					{:else}
						Whenever you launch something, this is where it will say what today needs.
					{/if}
				</p>
			{:else if pilot.mood === 'working'}
				<h2>All on pace</h2>
				<p class="muted">
					{pilot.steady}
					{pilot.steady === 1 ? 'orbit is' : 'orbits are'} in flight and none of them is behind.
					{#if subject}
						<a href={resolve('/goals/[id]', { id: subject.goal.id })}>{subject.goal.title}</a>
						has {timeLeft}.
					{/if}
				</p>
			{:else if pilot.mood === 'alert'}
				<h2>Worth a nudge</h2>
				<p class="muted">
					{#if subject}
						<a href={resolve('/goals/[id]', { id: subject.goal.id })}>{subject.goal.title}</a>
						has {remaining} to go, with {timeLeft}.
					{/if}
					{pilot.atRisk > 1 ? `${pilot.atRisk - 1} more could use a look.` : 'There is time.'}
				</p>
			{:else}
				<h2>Running out of {runningOut}</h2>
				<p class="muted">
					{#if subject}
						<a href={resolve('/goals/[id]', { id: subject.goal.id })}>{subject.goal.title}</a>
						is {remaining} short with {timeLeft}.
					{/if}
					A short orbit still counts for more than a skipped one.
				</p>
			{/if}
		</div>

		<button
			class="link-button dismiss tap"
			type="button"
			aria-label="Hide the pilot"
			title="Hide the pilot"
			onclick={() => setHidden(true)}
		>
			✕
		</button>
	</section>
{/if}

<style>
	.mascot {
		align-items: center;
		display: grid;
		gap: 1rem;
		/* The sprite gives up width before the copy does, so the panel works on a
		   phone without a second layout. */
		grid-template-columns: clamp(112px, 38%, var(--size, 160px)) 1fr;
		padding: var(--pad-panel);
		position: relative;
	}

	/*
	 * Compact asked for more goals on screen, and the pilot was taking a fifth
	 * of it. Narrowing its column is enough on its own: the astronaut is drawn
	 * to fit the space it is given, so it comes down with it.
	 */
	:global(html[data-density='compact']) .mascot {
		gap: 0.75rem;
		grid-template-columns: clamp(68px, 22%, 96px) 1fr;
	}

	.copy {
		display: grid;
		gap: 0.3rem;
		min-width: 0;
		/* Room for the dismiss glyph, which the headline would otherwise run
		   underneath when it wraps — the glyph, not the 44px hit area around it.
		   That area overhangs the copy invisibly, which costs nothing: there is
		   nothing interactive under it, and the top-right corner of a panel you
		   can dismiss is where a dismiss is expected to be. */
		padding-right: 2rem;
	}

	.copy h2 {
		font-size: 1.05rem;
	}

	.copy p {
		font-size: 0.9rem;
		text-wrap: pretty;
	}

	/* The mood is in the drawing; a border in the same key keeps it from being
	   the only place it shows up. */
	.mascot[data-mood='alert'] {
		border-color: rgba(251, 191, 36, 0.35);
	}

	.mascot[data-mood='adrift'] {
		border-color: rgba(251, 113, 133, 0.35);
	}

	.link-button {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		padding: 0.25rem;
	}

	.link-button:hover {
		color: var(--text-bright);
	}

	/* Sized by `.tap`: a ✕ glyph is about 20px of ink, and a control you dismiss
	   by accident is worse than one you cannot find. Pulled tight against the
	   corner so the larger hit area does not push the panel around. */
	.dismiss {
		font-size: 0.9rem;
		line-height: 1;
		position: absolute;
		right: 0;
		top: 0;
	}

	.recall {
		margin: -0.5rem 0 0;
	}

	@media (max-width: 22rem) {
		.mascot {
			grid-template-columns: 1fr;
			justify-items: center;
			padding-top: 1.75rem;
			text-align: center;
		}
	}
</style>
