<script lang="ts">
	import TierBody from '$components/TierBody.svelte';
	import type { Orbit } from '$domain/progress';
	import type { Tier } from '$domain/tiers';
	import { TIER_DEFINITIONS } from '$domain/tiers';

	/**
	 * One goal, drawn as an orbit.
	 *
	 * The arc is how much of the target is logged; the body sits at the matching
	 * point on the ring. A closed orbit keeps travelling, because a habit you
	 * have already hit should look alive rather than finished.
	 */

	interface Props {
		orbit: Orbit;
		tier: Tier;
		color: string;
		/** Rendered size in pixels. */
		size?: number;
		/** Text shown at the centre, e.g. `45m / 2h`. */
		caption?: string;
	}

	let { orbit, tier, color, size = 180, caption = '' }: Props = $props();

	const CENTER = 50;
	const RADIUS = 36;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	const tierDef = $derived(TIER_DEFINITIONS[tier]);
	const dashOffset = $derived(CIRCUMFERENCE * (1 - orbit.fraction));
	/** Degrees clockwise from the top of the ring. */
	const bodyAngle = $derived(orbit.angle);
	const bodyRadius = $derived(4.4 + tierDef.scale * 2.6);
	/** Satellites are small and fast; universes are vast and slow. */
	const orbitSeconds = $derived(14 + tierDef.scale * 26);
	/**
	 * Below roughly ten pixels across, the detail on a body stops being detail and
	 * starts being noise, so the body drops to its silhouette instead.
	 */
	const compact = $derived((2 * bodyRadius * size) / 100 < 11);
	/**
	 * Keep the divider attached to the amount it follows. A caption long enough
	 * to wrap — `180 pages / 300 pages` — should break after the slash, never
	 * start its second line with one.
	 */
	const captionText = $derived(caption.replace(' / ', '\u00a0/ '));

	/** Gradient ids have to be unique per dial and stable across hydration. */
	const uid = $props.id();
</script>

<div
	class="dial"
	class:dial--complete={orbit.complete && !orbit.dormant}
	class:dial--dormant={orbit.dormant}
	style="--size: {size}px; --color: {color}; --accent: {tierDef.accent}; --orbit-seconds: {orbitSeconds}s"
>
	<svg viewBox="0 0 100 100" role="presentation">
		<defs>
			<radialGradient id="core-{tier}">
				<stop offset="0%" stop-color="#fffbe8" />
				<stop offset="55%" stop-color={tierDef.accent} />
				<stop offset="100%" stop-color="transparent" />
			</radialGradient>
			<!-- The halo a body casts. A flat circle at low opacity reads as a disc
			     the body is sitting on, which flattens whatever is drawn on it. -->
			<radialGradient id="glow-{uid}">
				<stop offset="0%" stop-color="var(--color)" stop-opacity="0.45" />
				<stop offset="45%" stop-color="var(--color)" stop-opacity="0.18" />
				<stop offset="100%" stop-color="var(--color)" stop-opacity="0" />
			</radialGradient>
		</defs>

		<!-- Dust ring: decorative, always turning -->
		<circle class="dust" cx={CENTER} cy={CENTER} r={RADIUS + 6} />

		<!-- The orbital path -->
		<circle class="track" cx={CENTER} cy={CENTER} r={RADIUS} />

		<!-- Progress arc, drawn from the top -->
		<circle
			class="arc"
			cx={CENTER}
			cy={CENTER}
			r={RADIUS}
			stroke-dasharray={CIRCUMFERENCE}
			stroke-dashoffset={dashOffset}
		/>

		<!-- The star being orbited -->
		<circle class="core" cx={CENTER} cy={CENTER} r="11" fill="url(#core-{tier})" />

		<!-- The body itself, parked at the point the arc reached -->
		<g class="body-spin">
			<g style="transform: rotate({bodyAngle}deg); transform-origin: {CENTER}px {CENTER}px">
				{#if !orbit.dormant}
					<circle
						class="body-glow"
						cx={CENTER}
						cy={CENTER - RADIUS}
						r={bodyRadius * 2.3}
						fill="url(#glow-{uid})"
					/>
				{/if}
				<!-- Travelling round the ring must not tip the body over with it: a
				     planet's bands stay level however far along the arc it is. -->
				<g
					style="transform: rotate({-bodyAngle}deg); transform-origin: {CENTER}px {CENTER -
						RADIUS}px"
				>
					<TierBody
						{tier}
						cx={CENTER}
						cy={CENTER - RADIUS}
						r={bodyRadius}
						{compact}
						dormant={orbit.dormant}
						spinSeconds={orbitSeconds}
					/>
				</g>
			</g>
		</g>
	</svg>

	{#if caption}
		<div class="caption">
			<span class="caption__value">{captionText}</span>
			<span class="caption__tier">{tierDef.label}</span>
		</div>
	{/if}
</div>

<style>
	.dial {
		display: grid;
		justify-items: center;
		width: var(--size);
	}

	svg {
		aspect-ratio: 1;
		overflow: visible;
		width: 100%;
	}

	.dust {
		fill: none;
		stroke: rgba(148, 163, 214, 0.14);
		stroke-dasharray: 0.6 5;
		stroke-linecap: round;
		stroke-width: 0.7;
		transform-origin: 50px 50px;
		animation: spin calc(var(--orbit-seconds) * 4) linear infinite;
	}

	.track {
		fill: none;
		stroke: rgba(148, 163, 214, 0.18);
		stroke-dasharray: 2 3;
		stroke-width: 1.2;
	}

	.arc {
		fill: none;
		stroke: var(--color);
		stroke-linecap: round;
		stroke-width: 3.2;
		filter: drop-shadow(0 0 3px var(--color));
		transform: rotate(-90deg);
		transform-origin: 50px 50px;
		transition: stroke-dashoffset 700ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.core {
		animation: pulse 5.5s ease-in-out infinite;
		transform-origin: 50px 50px;
	}

	.body-glow {
		animation: pulse 3.5s ease-in-out infinite;
		transform-box: fill-box;
		transform-origin: center;
	}

	/* A period spent archived was never flown, so the whole dial goes cold: the
	   ring is drawn but nothing about it is lit. */
	.dial--dormant .arc {
		filter: none;
		opacity: 0.35;
		stroke: #7c87b4;
	}

	.dial--dormant .core {
		animation: none;
		opacity: 0.3;
	}

	.dial--dormant .dust {
		animation: none;
		opacity: 0.4;
	}

	/* A closed orbit keeps moving as its own small reward. */
	.dial--complete .body-spin {
		animation: spin var(--orbit-seconds) linear infinite;
		transform-origin: 50px 50px;
	}

	.dial--complete .arc {
		stroke-width: 3.8;
		filter: drop-shadow(0 0 6px var(--color));
	}

	.dial--complete .track {
		stroke: color-mix(in srgb, var(--color) 40%, transparent);
	}

	/* Below the ring rather than inside it: the orbit keeps its own space, and a
	   caption carrying units has room to sit on one line. The ring stops short of
	   the viewBox edge, so close that gap rather than measuring from the box. */
	.caption {
		display: grid;
		gap: 0.1rem;
		justify-items: center;
		margin-top: calc(var(--size) * -0.07);
		max-width: 100%;
		text-align: center;
		text-wrap: balance;
	}

	.caption__value {
		color: var(--text-bright);
		font-size: clamp(0.85rem, calc(var(--size) * 0.088), 1.1rem);
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.caption__tier {
		color: var(--text-dim);
		font-size: clamp(0.6rem, calc(var(--size) * 0.052), 0.72rem);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.85;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.08);
		}
	}
</style>
