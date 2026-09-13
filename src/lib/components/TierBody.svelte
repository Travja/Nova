<script module lang="ts">
	/**
	 * Geometry that is the same for every body ever drawn, so it is computed once
	 * rather than per instance.
	 */

	/**
	 * Points along one logarithmic spiral arm, in unit coordinates.
	 *
	 * Two arms and a short sweep: wind them any tighter and the strokes close up
	 * into a disc at the sizes this is actually drawn at.
	 */
	function arm(offset: number): string {
		const points: string[] = [];
		for (let step = 0; step <= 24; step += 1) {
			const sweep = (step / 24) * 2.5;
			const theta = sweep + offset;
			const radius = 0.3 * Math.exp(0.46 * sweep);
			points.push(
				`${(Math.cos(theta) * radius).toFixed(3)} ${(Math.sin(theta) * radius).toFixed(3)}`
			);
		}
		return `M ${points.join(' L ')}`;
	}

	const ARMS = [arm(0), arm(Math.PI)];

	/**
	 * The same seeded generator the starfield uses. A universe is a field of
	 * distant light, and that field has to be identical on the server and in the
	 * browser or hydration tears it apart.
	 */
	function seeded(seed: number) {
		let state = seed;
		return () => {
			state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
			return state / 2_147_483_648;
		};
	}

	interface FarStar {
		x: number;
		y: number;
		size: number;
		delay: number;
		/** Bright enough to survive being shrunk to a few pixels. */
		near: boolean;
	}

	const FIELD: FarStar[] = (() => {
		const random = seeded(52_711);
		return Array.from({ length: 18 }, (_, index) => {
			const angle = random() * Math.PI * 2;
			// Square-rooting the radius spreads the stars evenly over the disc
			// instead of piling them into the middle.
			const radius = Math.sqrt(random()) * 0.82;
			return {
				x: Number((Math.cos(angle) * radius).toFixed(3)),
				y: Number((Math.sin(angle) * radius).toFixed(3)),
				size: Number((0.05 + random() * 0.07).toFixed(3)),
				delay: Number((random() * 4).toFixed(2)),
				near: index % 5 === 0
			};
		});
	})();

	/** The handful of stars that still read once the field is a few pixels across. */
	const NEAR_FIELD = FIELD.filter((star) => star.near);
</script>

<script lang="ts">
	import type { Tier } from '$domain/tiers';

	/**
	 * The body at the end of a goal's arc.
	 *
	 * Each tier gets its own silhouette, so the dial says which scale a goal flies
	 * at before the label is read. Everything is drawn inside a unit circle and
	 * scaled into place by the caller, which is what lets one component serve a
	 * 24px history ring and a 230px hero dial.
	 *
	 * Colour comes from `--color` on an ancestor — the goal's own colour, which
	 * the dial already sets.
	 */
	interface Props {
		tier: Tier;
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

	let { tier, cx, cy, r, compact = false, dormant = false, spinSeconds = 26 }: Props = $props();

	// Clip paths need an id that is unique per instance and identical on both
	// sides of hydration, which is exactly what this gives.
	const uid = $props.id();

	const field = $derived(compact ? NEAR_FIELD : FIELD);
</script>

<g
	class="body"
	class:is-dormant={dormant}
	style="--spin: {spinSeconds}s"
	transform="translate({cx} {cy}) scale({r})"
>
	{#if tier === 'satellite'}
		<!-- A comsat: panels make a silhouette no other tier has. -->
		{#if compact}
			<rect class="panel" x="-1.6" y="-0.32" width="3.2" height="0.64" rx="0.2" />
			<circle class="hull" cx="0" cy="0" r="0.66" />
		{:else}
			<g class="rock">
				<rect class="panel" x="-1.78" y="-0.48" width="0.98" height="0.96" rx="0.14" />
				<rect class="panel" x="0.8" y="-0.48" width="0.98" height="0.96" rx="0.14" />
				<path class="grid" d="M-1.45 -0.48V0.48M-1.13 -0.48V0.48M1.13 -0.48V0.48M1.45 -0.48V0.48" />
				<path class="strut" d="M-0.82 0H0.82" />
				<rect class="hull" x="-0.62" y="-0.72" width="1.24" height="1.44" rx="0.4" />
				<path class="mast" d="M0 -0.72V-1.02" />
				<path class="dish" d="M-0.42 -1.02A0.42 0.42 0 0 1 0.42 -1.02Z" />
				<circle class="beacon" cx="0" cy="0.82" r="0.16" />
			</g>
		{/if}
	{:else if tier === 'planet'}
		<!-- A banded world. The bands drift rather than spin: two dimensions can
		     only suggest rotation, and a slow drift suggests it honestly. -->
		<clipPath id="planet-{uid}"><circle cx="0" cy="0" r="1" /></clipPath>
		<circle class="surface" cx="0" cy="0" r="1" />
		<g clip-path="url(#planet-{uid})">
			{#if compact}
				<ellipse class="band band--dark" cx="0" cy="0.06" rx="1.4" ry="0.3" />
				<ellipse class="band band--pale" cx="0" cy="-0.58" rx="1.4" ry="0.22" />
			{:else}
				<g class="bands">
					<ellipse class="band band--pale" cx="0" cy="-0.62" rx="1.6" ry="0.2" />
					<ellipse class="band band--dark" cx="0" cy="-0.22" rx="1.7" ry="0.17" />
					<ellipse class="band band--pale" cx="0" cy="0.16" rx="1.7" ry="0.24" />
					<ellipse class="band band--dark" cx="0" cy="0.58" rx="1.5" ry="0.15" />
					<ellipse class="spot" cx="-0.34" cy="0.2" rx="0.3" ry="0.16" />
				</g>
			{/if}
			<circle class="terminator" cx="1.12" cy="0.22" r="1" />
		</g>
	{:else if tier === 'starSystem'}
		<!-- A star with worlds of its own, on rings it keeps. -->
		{#if !compact}
			<circle class="orbit-line" cx="0" cy="0" r="0.74" />
			<circle class="orbit-line" cx="0" cy="0" r="1.18" />
		{/if}
		<path
			class="flare"
			d="M0 -1.45L0.12 -0.16L1.45 0L0.12 0.16L0 1.45L-0.12 0.16L-1.45 0L-0.12 -0.16Z"
		/>
		<circle class="star-core" cx="0" cy="0" r={compact ? 0.5 : 0.34} />
		{#if !compact}
			<g class="worlds">
				<circle class="world" cx="0.74" cy="0" r="0.15" />
			</g>
			<g class="worlds worlds--outer">
				<circle class="world" cx="-1.18" cy="0" r="0.2" />
				<ellipse class="world-ring" cx="-1.18" cy="0" rx="0.34" ry="0.11" />
			</g>
		{/if}
	{:else if tier === 'galaxy'}
		<!-- A spiral, turning slowly enough that you notice it twice. -->
		<circle class="halo" cx="0" cy="0" r="0.95" />
		<g class="swirl">
			<path class="arm" d={ARMS[0]} />
			<path class="arm" d={ARMS[1]} />
		</g>
		<ellipse
			class="galaxy-core"
			cx="0"
			cy="0"
			rx={compact ? 0.34 : 0.28}
			ry={compact ? 0.26 : 0.2}
		/>
	{:else}
		<!-- Everything: a dark field with light scattered through it. -->
		<circle class="void" cx="0" cy="0" r="1" />
		<circle class="haze" cx="0" cy="0" r="0.92" />
		{#each field as star, index (index)}
			<circle
				class="far-star"
				cx={star.x}
				cy={star.y}
				r={compact ? star.size * 2 : star.size * 1.35}
				style="--twinkle-delay: {star.delay}s"
			/>
		{/each}
		<circle class="rim" cx="0" cy="0" r="1" />
	{/if}
</g>

<style>
	.body {
		/* One switch for every fill below, so a dormant body is unlit rather than
		   a different drawing. */
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

	/* ---- Satellite ---------------------------------------------------- */

	.hull {
		fill: var(--pale);
	}

	.panel {
		fill: var(--deep);
		stroke: var(--lit);
		stroke-width: 0.07;
	}

	.grid {
		stroke: var(--lit);
		stroke-width: 0.05;
		opacity: 0.7;
	}

	.strut,
	.mast {
		stroke: var(--pale);
		stroke-width: 0.12;
		stroke-linecap: round;
	}

	.dish {
		fill: var(--pale);
	}

	.beacon {
		fill: #fff6d8;
		animation: blink 2.6s steps(1, end) infinite;
		animation-play-state: var(--motion, running);
	}

	.rock {
		animation: rock calc(var(--spin) * 0.7) ease-in-out infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	/* ---- Planet ------------------------------------------------------- */

	.surface {
		fill: var(--lit);
	}

	.band {
		opacity: 0.6;
	}

	.band--pale {
		fill: var(--pale);
	}

	.band--dark {
		fill: var(--deep);
		opacity: 0.45;
	}

	.spot {
		fill: var(--pale);
		opacity: 0.8;
	}

	.bands {
		animation: drift calc(var(--spin) * 1.6) ease-in-out infinite alternate;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.terminator {
		fill: var(--shadow);
		opacity: 0.55;
	}

	/* ---- Star system -------------------------------------------------- */

	.flare {
		fill: var(--lit);
		opacity: 1;
		animation: flare 4.5s ease-in-out infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.star-core {
		fill: #fffdf2;
	}

	.orbit-line {
		fill: none;
		stroke: var(--pale);
		stroke-width: 0.07;
		opacity: 0.85;
	}

	.world {
		fill: var(--pale);
	}

	.world-ring {
		fill: none;
		stroke: var(--pale);
		stroke-width: 0.06;
		opacity: 0.8;
	}

	.worlds {
		animation: revolve calc(var(--spin) * 0.55) linear infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.worlds--outer {
		animation-duration: var(--spin);
		animation-direction: reverse;
	}

	/* ---- Galaxy ------------------------------------------------------- */

	.swirl {
		animation: revolve calc(var(--spin) * 1.5) linear infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.arm {
		fill: none;
		stroke: var(--lit);
		stroke-linecap: round;
		stroke-width: 0.24;
	}

	.halo {
		fill: var(--lit);
		opacity: 0.12;
	}

	.galaxy-core {
		fill: #fff;
		opacity: 0.9;
	}

	/* ---- Universe ----------------------------------------------------- */

	.void {
		fill: #0a0f26;
	}

	.haze {
		fill: var(--lit);
		opacity: 0.22;
	}

	.far-star {
		fill: #fff;
		animation: twinkle 4.5s ease-in-out infinite;
		animation-delay: var(--twinkle-delay);
		animation-play-state: var(--motion, running);
	}

	.rim {
		fill: none;
		stroke: var(--pale);
		stroke-width: 0.09;
		opacity: 0.95;
	}

	@keyframes blink {
		0%,
		45% {
			opacity: 1;
		}
		46%,
		100% {
			opacity: 0.15;
		}
	}

	@keyframes rock {
		0%,
		100% {
			transform: rotate(-7deg);
		}
		50% {
			transform: rotate(7deg);
		}
	}

	@keyframes drift {
		from {
			transform: translateX(-0.28px);
		}
		to {
			transform: translateX(0.28px);
		}
	}

	@keyframes flare {
		0%,
		100% {
			transform: scale(0.92) rotate(0deg);
			opacity: 0.75;
		}
		50% {
			transform: scale(1.06) rotate(45deg);
			opacity: 1;
		}
	}

	@keyframes revolve {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes twinkle {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
</style>
