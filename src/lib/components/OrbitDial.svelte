<script lang="ts">
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
	const bodyRadius = $derived(3.2 + tierDef.scale * 2.2);
	/** Satellites are small and fast; universes are vast and slow. */
	const orbitSeconds = $derived(14 + tierDef.scale * 26);
</script>

<div
	class="dial"
	class:dial--complete={orbit.complete}
	style="--size: {size}px; --color: {color}; --accent: {tierDef.accent}; --orbit-seconds: {orbitSeconds}s"
>
	<svg viewBox="0 0 100 100" role="presentation">
		<defs>
			<radialGradient id="core-{tier}">
				<stop offset="0%" stop-color="#fffbe8" />
				<stop offset="55%" stop-color={tierDef.accent} />
				<stop offset="100%" stop-color="transparent" />
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
		<circle class="core" cx={CENTER} cy={CENTER} r={caption ? 6 : 11} fill="url(#core-{tier})" />

		<!-- The body itself, parked at the point the arc reached -->
		<g class="body-spin">
			<g style="transform: rotate({bodyAngle}deg); transform-origin: {CENTER}px {CENTER}px">
				<circle class="body-glow" cx={CENTER} cy={CENTER - RADIUS} r={bodyRadius * 2.1} />
				<circle class="body" cx={CENTER} cy={CENTER - RADIUS} r={bodyRadius} />
				{#if tier === 'starSystem' || tier === 'galaxy' || tier === 'universe'}
					<ellipse
						class="body-ring"
						cx={CENTER}
						cy={CENTER - RADIUS}
						rx={bodyRadius * 1.9}
						ry={bodyRadius * 0.6}
					/>
				{/if}
			</g>
		</g>
	</svg>

	{#if caption}
		<div class="caption">
			<span class="caption__value">{caption}</span>
			<span class="caption__tier">{tierDef.label}</span>
		</div>
	{/if}
</div>

<style>
	.dial {
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		position: relative;
		width: var(--size);
	}

	svg {
		height: 100%;
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

	/* The caption sits on top of the star, so the star steps back for it. */
	.dial:has(.caption) .core {
		opacity: 0.55;
	}

	.body {
		fill: var(--color);
	}

	.body-glow {
		fill: var(--color);
		opacity: 0.22;
		animation: pulse 3.5s ease-in-out infinite;
		transform-box: fill-box;
		transform-origin: center;
	}

	.body-ring {
		fill: none;
		stroke: var(--color);
		stroke-width: 0.7;
		opacity: 0.75;
		transform-box: fill-box;
		transform-origin: center;
		transform: rotate(-22deg);
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

	.caption {
		display: grid;
		gap: 0.1rem;
		justify-items: center;
		pointer-events: none;
		position: absolute;
		text-align: center;
	}

	.caption__value {
		color: var(--text-bright);
		text-shadow: 0 1px 6px rgba(4, 5, 13, 0.95);
		font-size: calc(var(--size) * 0.098);
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.caption__tier {
		color: var(--text-dim);
		text-shadow: 0 1px 6px rgba(4, 5, 13, 0.95);
		font-size: calc(var(--size) * 0.058);
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
