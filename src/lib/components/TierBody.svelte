<script lang="ts">
	import Galaxy from '$components/bodies/Galaxy.svelte';
	import Planet from '$components/bodies/Planet.svelte';
	import Satellite from '$components/bodies/Satellite.svelte';
	import StarSystem from '$components/bodies/StarSystem.svelte';
	import Universe from '$components/bodies/Universe.svelte';
	import type { Tier } from '$domain/tiers';

	/**
	 * The body at the end of a goal's arc.
	 *
	 * Each tier gets its own silhouette, so the dial says which scale a goal flies
	 * at before the label is read, and each tier has a few of them so a dashboard
	 * of six satellites is not one drawing repeated six times. Which body a goal
	 * flies is pinned to its id by `bodyVariant`, upstream of here.
	 *
	 * Everything is drawn inside a unit circle and scaled into place by the
	 * caller, which is what lets one component serve a 24px history ring and a
	 * 230px hero dial. Colour comes from `--color` on an ancestor — the goal's own
	 * colour, which the dial already sets.
	 */
	interface Props {
		tier: Tier;
		/** Which body of the tier, as `bodyVariant` picked it. */
		variant?: number;
		/** Centre, in the parent's user units. */
		cx: number;
		cy: number;
		/** Radius, in the parent's user units. */
		r: number;
		/** Detail finer than a pixel is mush, so small bodies drop it. */
		compact?: boolean;
		/** Archived for this whole period: unlit, and never moving. */
		dormant?: boolean;
		/** Seconds for one turn of whatever this body turns. */
		spinSeconds?: number;
	}

	let {
		tier,
		variant = 0,
		cx,
		cy,
		r,
		compact = false,
		dormant = false,
		spinSeconds = 26
	}: Props = $props();
</script>

<g
	class="body"
	class:is-dormant={dormant}
	style="--spin: {spinSeconds}s"
	transform="translate({cx} {cy}) scale({r})"
>
	{#if tier === 'satellite'}
		<Satellite {variant} {compact} />
	{:else if tier === 'planet'}
		<Planet {variant} {compact} />
	{:else if tier === 'starSystem'}
		<StarSystem {variant} {compact} />
	{:else if tier === 'galaxy'}
		<Galaxy {variant} {compact} />
	{:else}
		<Universe {variant} {compact} />
	{/if}
</g>

<style>
	.body {
		/* One switch for every fill in the bodies, which inherit these, so a
		   dormant body is unlit rather than a different drawing. */
		--lit: var(--color, #a78bfa);
		--pale: color-mix(in srgb, var(--lit) 42%, #ffffff);
		--deep: color-mix(in srgb, var(--lit) 40%, #05070f);
		--shadow: rgba(4, 6, 18, 0.55);
	}

	/*
	 * A period the goal spent archived never flew, so its body is drawn cold:
	 * grey, dimmed and still. That is what keeps it from reading as a period the
	 * pilot simply missed.
	 */
	.is-dormant {
		--lit: #7c87b4;
		--pale: #97a1c6;
		--deep: #444e75;
		--shadow: rgba(4, 6, 18, 0.4);
		--motion: paused;
		opacity: 0.5;
	}
</style>
