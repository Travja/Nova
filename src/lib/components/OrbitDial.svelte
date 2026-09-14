<script lang="ts">
	import TierBody from '$components/TierBody.svelte';
	import { celebrationFor } from '$lib/celebration.svelte';
	import { bodyVariant } from '$domain/bodies';
	import { MIN_DIAL_SCALE } from '$domain/preferences';
	import { SWEEP_MS, rayAngles } from '$domain/celebration';
	import type { ChildStanding, Orbit } from '$domain/progress';
	import type { Tier } from '$domain/tiers';
	import { TIER_DEFINITIONS } from '$domain/tiers';

	/**
	 * One goal, drawn as an orbit.
	 *
	 * The arc is how much of the target is logged; the body sits at the matching
	 * point on the ring. A closed orbit keeps travelling, because a habit you
	 * have already hit should look alive rather than finished.
	 *
	 * ## Nested orbits
	 *
	 * A derived goal's children are drawn as bodies orbiting its own body — the
	 * thing the tier ladder has been promising since the scaffold, and the reason
	 * the metaphor is a nesting one rather than five buckets. Each child gets its
	 * own small ring around the parent's body and sits at its own progress angle,
	 * so one dial says the same thing at two scales: how far round the month is,
	 * and how far round the week inside it is.
	 *
	 * Everything about a child is drawn inside the counter-rotated group that
	 * keeps the parent's body level, so a moon does not swing round the planet
	 * just because the planet moved along its year.
	 */

	interface Props {
		orbit: Orbit;
		tier: Tier;
		color: string;
		/** Rendered size in pixels. */
		size?: number;
		/** Text shown at the centre, e.g. `45m / 2h`. */
		caption?: string;
		/**
		 * The goal this dial is drawing. It pins which body of the tier is flown,
		 * and it is how the dial catches the moment that goal closes an orbit.
		 * Left out — by the form preview, which has no goal yet — the dial draws
		 * the tier's first body and never celebrates.
		 */
		goalId?: string;
		/**
		 * The children this goal counts, each drawn orbiting its body. Empty for
		 * every goal that is not derived, which is every goal that can be logged
		 * against.
		 */
		satellites?: readonly ChildStanding[];
	}

	let {
		orbit,
		tier,
		color,
		size = 180,
		caption = '',
		goalId = '',
		satellites = []
	}: Props = $props();

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
	 *
	 * Measured at the smallest this dial can be drawn rather than at `size`,
	 * because the density that scales it lives in CSS and is not readable from
	 * here. Erring that way is the safe direction: a silhouette drawn slightly
	 * larger than it had to be still reads, whereas detail at 9px does not.
	 */
	const compact = $derived((2 * bodyRadius * size * MIN_DIAL_SCALE) / 100 < 11);
	/**
	 * Keep the divider attached to the amount it follows. A caption long enough
	 * to wrap — `180 pages / 300 pages` — should break after the slash, never
	 * start its second line with one.
	 */
	const captionText = $derived(caption.replace(' / ', '\u00a0/ '));

	/** Gradient ids have to be unique per dial and stable across hydration. */
	const uid = $props.id();

	/** The body this goal flies, which never changes under it. */
	const variant = $derived(bodyVariant(tier, goalId));

	/** A moon is a fraction of the body it orbits, never a fraction of the dial. */
	const moonRadius = $derived(Math.max(1.4, bodyRadius * 0.3));
	/**
	 * How many children a dial can carry before it is a smudge round a planet.
	 *
	 * Each one needs a ring of its own — several children at the same progress
	 * would otherwise sit on top of each other, and spreading them by index would
	 * be a position that means nothing — and the rings have to stay inside the
	 * dial. Four is where both run out. The list beside the dial carries the rest,
	 * and the number the dial is drawing is a count either way.
	 */
	const MAX_MOONS = 4;
	/**
	 * Measured the way `compact` is, at the smallest this dial can be drawn: below
	 * about three pixels a moon is a speck that reads as a rendering artefact
	 * rather than as a body, so the dial draws the parent alone and the copy
	 * beside it does the work.
	 */
	const moons = $derived(
		(2 * moonRadius * size * MIN_DIAL_SCALE) / 100 >= 3 ? satellites.slice(0, MAX_MOONS) : []
	);
	/** Rings step outwards so two children at the same angle are still two bodies. */
	const moonRing = (index: number) => bodyRadius * (1.55 + index * 0.32);
	/** Set for as long as this goal's closing is being celebrated. */
	const closing = $derived(goalId ? celebrationFor(goalId) : null);
	const rays = $derived(closing ? rayAngles(closing.shape.rays) : []);
</script>

<div
	class="dial"
	class:dial--complete={orbit.complete && !orbit.dormant}
	class:dial--dormant={orbit.dormant}
	style="--size: calc({size}px * var(--dial-scale)); --color: {color}; --accent: {tierDef.accent}; --orbit-seconds: {orbitSeconds}s; --sweep-ms: {SWEEP_MS}ms"
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
			<g
				class="travel"
				style="transform: rotate({bodyAngle}deg); transform-origin: {CENTER}px {CENTER}px"
			>
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
				{#if closing}
					<!-- Keyed on the stamp so a second closing restarts the animation
					     rather than sitting out the first one's tail. -->
					{#key closing.stamp}
						<g class="burst" style="--burst-ms: {closing.shape.ms}ms">
							<circle
								class="burst__wave"
								cx={CENTER}
								cy={CENTER - RADIUS}
								r={bodyRadius}
								style="transform-origin: {CENTER}px {CENTER - RADIUS}px; --reach: {closing.shape
									.reach}"
							/>
							<g class="burst__rays" style="transform-origin: {CENTER}px {CENTER - RADIUS}px">
								{#each rays as angle (angle)}
									<line
										class="burst__ray"
										x1={CENTER}
										y1={CENTER - RADIUS - bodyRadius * 1.15}
										x2={CENTER}
										y2={CENTER - RADIUS - bodyRadius * closing.shape.reach}
										style="transform: rotate({angle}deg); transform-origin: {CENTER}px {CENTER -
											RADIUS}px"
									/>
								{/each}
							</g>
							<circle
								class="burst__flash"
								cx={CENTER}
								cy={CENTER - RADIUS}
								r={bodyRadius * 1.1}
								style="transform-origin: {CENTER}px {CENTER - RADIUS}px"
							/>
						</g>
					{/key}
				{/if}
				<g
					class="travel"
					style="transform: rotate({-bodyAngle}deg); transform-origin: {CENTER}px {CENTER -
						RADIUS}px"
				>
					<TierBody
						{tier}
						{variant}
						cx={CENTER}
						cy={CENTER - RADIUS}
						r={bodyRadius}
						{compact}
						dormant={orbit.dormant}
						spinSeconds={orbitSeconds}
					/>

					{#each moons as moon, index (moon.goalId)}
						{@const ring = moonRing(index)}
						<g
							class="moon"
							class:moon--complete={moon.current.complete && !moon.current.dormant}
							class:moon--dormant={moon.current.dormant}
							style="--moon-color: {moon.color}; --moon-seconds: {orbitSeconds *
								0.45}s; transform-origin: {CENTER}px {CENTER - RADIUS}px"
						>
							<circle class="moon__track" cx={CENTER} cy={CENTER - RADIUS} r={ring} />
							<g
								class="moon__travel"
								style="transform: rotate({moon.current
									.angle}deg); transform-origin: {CENTER}px {CENTER - RADIUS}px"
							>
								<!-- The child's own colour, which `TierBody` reads off an ancestor. -->
								<g style="--color: {moon.color}">
									<TierBody
										tier={moon.tier}
										variant={bodyVariant(moon.tier, moon.goalId)}
										cx={CENTER}
										cy={CENTER - RADIUS - ring}
										r={moonRadius}
										compact
										dormant={moon.current.dormant}
										spinSeconds={orbitSeconds}
									/>
								</g>
							</g>
						</g>
					{/each}
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
		transition: stroke-dashoffset var(--sweep-ms) cubic-bezier(0.22, 1, 0.36, 1);
	}

	/*
	 * The body travels round to the arc rather than jumping to it. Position and
	 * fill are the same fact told twice, so they have to move as one — an arc
	 * that sweeps while the body is already waiting at the end of it is the dial
	 * disagreeing with itself for two thirds of a second.
	 *
	 * Both rotations carry this: the outer one walks the body round the ring,
	 * the inner one cancels that rotation so a planet's bands stay level, and
	 * they are only level at every frame if they share a duration and an easing.
	 *
	 * Reduced motion flattens both through the global rule in `app.css`, which
	 * leaves the body where the arc says it is, instantly.
	 */
	.travel {
		transition: transform var(--sweep-ms) cubic-bezier(0.22, 1, 0.36, 1);
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

	/*
	 * The moment an orbit closes: an ignition where the body reached, rays out of
	 * it, and a wave that leaves the ring behind. The arc sweeping up to it is
	 * the transition on `.arc` above, which is what makes the two read as one
	 * movement rather than a flash on top of a jump.
	 */
	.burst {
		pointer-events: none;
	}

	.burst__flash {
		fill: #fff;
		animation: flash var(--burst-ms) ease-out forwards;
	}

	.burst__wave {
		fill: none;
		stroke: var(--color);
		stroke-width: 1.4;
		animation: wave var(--burst-ms) cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.burst__rays {
		animation: rays var(--burst-ms) cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	.burst__ray {
		filter: drop-shadow(0 0 2px var(--color));
		stroke: var(--color);
		stroke-linecap: round;
		stroke-width: 1.3;
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

	/*
	 * A child orbiting its parent. The ring is drawn the same way the parent's
	 * own track is — dotted, unlit — so the two read as the same kind of thing at
	 * two scales, and the body on it sits at its own progress angle.
	 */
	.moon__track {
		fill: none;
		stroke: color-mix(in srgb, var(--moon-color) 45%, transparent);
		stroke-dasharray: 1 2.4;
		stroke-width: 0.5;
	}

	/* Moves with the parent's body for the same reason the parent's does: the
	   arc sweeps, so anything reading it has to arrive with it. */
	.moon__travel {
		transition: transform var(--sweep-ms) cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* A closed child keeps circling, the small version of the reward the parent
	   gets for closing its own orbit. */
	.moon--complete {
		animation: spin var(--moon-seconds) linear infinite;
	}

	.moon--dormant .moon__track {
		opacity: 0.3;
		stroke: #7c87b4;
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

	@keyframes flash {
		0% {
			opacity: 1;
			transform: scale(0.4);
		}
		35% {
			opacity: 0.45;
			transform: scale(1.4);
		}
		100% {
			opacity: 0;
			transform: scale(2);
		}
	}

	@keyframes wave {
		0% {
			opacity: 0.85;
			transform: scale(0.6);
		}
		100% {
			opacity: 0;
			transform: scale(var(--reach));
		}
	}

	@keyframes rays {
		0% {
			opacity: 0;
			transform: scale(0.25);
		}
		15%,
		55% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: scale(1);
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

	/* Under reduced motion the closed state is the whole celebration: the arc is
	   already full and the caption already says so, so nothing else happens. */
	@media (prefers-reduced-motion: reduce) {
		.burst {
			display: none;
		}
	}
</style>
