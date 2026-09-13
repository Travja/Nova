<script module lang="ts">
	/**
	 * Spiral arms, computed once for every galaxy ever drawn.
	 *
	 * Two arms and a short sweep: wind them any tighter and the strokes close up
	 * into a disc at the sizes this is actually drawn at.
	 */
	function arm(offset: number, start: number, sweep: number): string {
		const points: string[] = [];
		for (let step = 0; step <= 24; step += 1) {
			const along = (step / 24) * sweep;
			const theta = along + offset;
			const radius = start * Math.exp(0.46 * along);
			points.push(
				`${(Math.cos(theta) * radius).toFixed(3)} ${(Math.sin(theta) * radius).toFixed(3)}`
			);
		}
		return `M ${points.join(' L ')}`;
	}

	const ARMS = [arm(0, 0.24, 2.9), arm(Math.PI, 0.24, 2.9)];
	/** A bar galaxy's arms start out at the ends of the bar. */
	const BARRED = [arm(0, 0.62, 1.2), arm(Math.PI, 0.62, 1.2)];
</script>

<script lang="ts">
	/** Galaxies: a spiral, a barred spiral, and an elliptical. */
	interface Props {
		variant: number;
		compact: boolean;
	}

	let { variant, compact }: Props = $props();
</script>

{#if variant === 1}
	<!-- Barred: the core is drawn out into a bar the arms leave from. -->
	<circle class="halo" cx="0" cy="0" r="0.95" />
	<g class="swirl">
		<path class="arm" d={BARRED[0]} />
		<path class="arm" d={BARRED[1]} />
		<rect
			class="bar"
			x="-0.66"
			y={compact ? -0.26 : -0.21}
			width="1.32"
			height={compact ? 0.52 : 0.42}
			rx="0.21"
		/>
	</g>
	<ellipse class="galaxy-core" cx="0" cy="0" rx={compact ? 0.3 : 0.24} ry={compact ? 0.24 : 0.19} />
{:else if variant === 2}
	<!-- Elliptical: no arms, just a great deal of old light. -->
	<g class="drift-slow">
		<ellipse class="glow" cx="0" cy="0" rx="1.05" ry="0.7" transform="rotate(-24)" />
		<ellipse class="glow glow--mid" cx="0" cy="0" rx="0.78" ry="0.5" transform="rotate(-24)" />
		<ellipse class="glow glow--inner" cx="0" cy="0" rx="0.46" ry="0.3" transform="rotate(-24)" />
		{#if !compact}
			<circle class="grain" cx="-0.62" cy="0.2" r="0.06" />
			<circle class="grain" cx="0.54" cy="-0.28" r="0.05" />
			<circle class="grain" cx="0.18" cy="0.36" r="0.045" />
		{/if}
	</g>
	<ellipse class="galaxy-core" cx="0" cy="0" rx={compact ? 0.28 : 0.22} ry={compact ? 0.2 : 0.16} />
{:else}
	<!-- A spiral, turning slowly enough that you notice it twice. -->
	<circle class="halo" cx="0" cy="0" r="0.95" />
	<g class="swirl">
		<path class="arm" d={ARMS[0]} />
		<path class="arm" d={ARMS[1]} />
	</g>
	<ellipse class="galaxy-core" cx="0" cy="0" rx={compact ? 0.3 : 0.22} ry={compact ? 0.24 : 0.17} />
{/if}

<style>
	.swirl,
	.drift-slow {
		animation: revolve calc(var(--spin) * 1.5) linear infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.drift-slow {
		animation-duration: calc(var(--spin) * 4);
	}

	.arm {
		fill: none;
		stroke: var(--lit);
		stroke-linecap: round;
		stroke-width: 0.2;
	}

	.bar {
		fill: var(--lit);
		opacity: 0.95;
	}

	.halo {
		fill: var(--lit);
		opacity: 0.12;
	}

	.glow {
		fill: var(--lit);
		opacity: 0.35;
	}

	.glow--mid {
		opacity: 0.45;
	}

	.glow--inner {
		opacity: 0.6;
	}

	.grain {
		fill: #fff;
		opacity: 0.75;
	}

	.galaxy-core {
		fill: #fff;
		opacity: 0.9;
	}

	@keyframes revolve {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
