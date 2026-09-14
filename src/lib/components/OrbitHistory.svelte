<script lang="ts">
	import TierBody from '$components/TierBody.svelte';
	import { bodyVariant } from '$domain/bodies';
	import { periodName, periodShortName } from '$domain/period';
	import type { Orbit } from '$domain/progress';
	import { orbitStanding } from '$domain/progress';
	import type { Tier } from '$domain/tiers';

	/**
	 * The last handful of orbits as small rings — a streak you can read at a glance.
	 *
	 * Same convention as `OrbitDial`, which is the point of it being a convention:
	 * the ring is decorative and the text under it is the orbit. The rings used to
	 * carry an `aria-label` built from the raw period key, so a year of weekly
	 * history announced itself as "week:2026-W37: 80%" forty times over. The key
	 * is now read back as the date it was minted from, in both the visible label
	 * and the sentence beside it.
	 */
	interface Props {
		history: readonly Orbit[];
		tier: Tier;
		/** Pins the body, so the strip flies the same one the dial above it does. */
		goalId: string;
		color: string;
	}

	let { history, tier, goalId, color }: Props = $props();

	const variant = $derived(bodyVariant(tier, goalId));

	const CENTER = 12;
	const RADIUS = 9;
	/** Small enough to sit on the ring, large enough to still have a silhouette. */
	const BODY = 3.6;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	/** Oldest first reads like a timeline. */
	const ordered = $derived([...history].reverse());

	/** `7 Sep` — as much of the date as fits under a 24px ring. */
	function shortLabel(orbit: Orbit): string {
		return periodShortName(orbit.period.key);
	}

	/** `Week of 7 September 2026: 80% of target logged`. */
	function fullLabel(orbit: Orbit): string {
		return `${periodName(orbit.period.key)}: ${orbitStanding(orbit)}`;
	}
</script>

<ol class="history" style="--color: {color}">
	{#each ordered as orbit, index (orbit.period.key)}
		<li class:is-current={index === ordered.length - 1} class:is-dormant={orbit.dormant}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle class="track" class:dashed={orbit.dormant} cx={CENTER} cy={CENTER} r={RADIUS} />
				<circle
					class="fill"
					class:complete={orbit.complete}
					cx={CENTER}
					cy={CENTER}
					r={RADIUS}
					stroke-dasharray={CIRCUMFERENCE}
					stroke-dashoffset={CIRCUMFERENCE * (1 - orbit.fraction)}
				/>
				<g style="transform: rotate({orbit.angle}deg); transform-origin: {CENTER}px {CENTER}px">
					<TierBody
						{tier}
						{variant}
						cx={CENTER}
						cy={CENTER - RADIUS}
						r={BODY}
						compact
						dormant={orbit.dormant}
					/>
				</g>
			</svg>
			<!-- The ring's equivalent, and the only thing here a screen reader
			     sees: the date it is drawn for, then what the arc made of it. A
			     dormant period says so in words rather than only going cold. -->
			<span class="label muted" aria-hidden="true">{shortLabel(orbit)}</span>
			<span class="visually-hidden">{fullLabel(orbit)}</span>
		</li>
	{/each}
</ol>

<style>
	.history {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: grid;
		gap: 0.2rem;
		justify-items: center;
	}

	/*
	 * The ring fades, not the date under it.
	 *
	 * This used to dim the whole item, which took an 11px label down with it —
	 * `--text-dim` at 75% opacity misses AA, and a dormant row at 40% misses it
	 * badly. The hierarchy was only ever about the rings; the dates are
	 * reference, and reference has to stay readable.
	 */
	li svg {
		opacity: 0.75;
	}

	li.is-current svg {
		opacity: 1;
	}

	/* A period spent archived was never missed, so it should not read as a gap. */
	li.is-dormant svg {
		opacity: 0.4;
	}

	svg {
		height: 2.3rem;
		overflow: visible;
		width: 2.3rem;
	}

	.track {
		fill: none;
		stroke: rgba(148, 163, 214, 0.2);
		stroke-width: 2.4;
	}

	.track.dashed {
		stroke-dasharray: 2 3;
	}

	.fill {
		fill: none;
		stroke: var(--color);
		stroke-linecap: round;
		stroke-width: 2.4;
		transform: rotate(-90deg);
		transform-origin: 12px 12px;
		opacity: 0.7;
	}

	.fill.complete {
		opacity: 1;
		filter: drop-shadow(0 0 3px var(--color));
	}

	/*
	 * `--text-label` rather than a hard-coded size: it is the app's floor for
	 * small type and the one token density deliberately does not shrink, which
	 * is exactly what a date under a 24px ring needs.
	 */
	.label {
		font-size: var(--text-label);
		letter-spacing: 0.02em;
	}
</style>
