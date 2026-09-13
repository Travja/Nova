<script lang="ts">
	/**
	 * Star systems: a star keeping worlds on rings, a binary pair, and a star with
	 * one big ringed world on a tilted orbit.
	 *
	 * The flare is thin on purpose — a fat one swallows the rings at card size and
	 * the whole thing turns into a blob.
	 */
	interface Props {
		variant: number;
		compact: boolean;
	}

	let { variant, compact }: Props = $props();

	const FLARE = 'M0 -1.45L0.12 -0.16L1.45 0L0.12 0.16L0 1.45L-0.12 0.16L-1.45 0L-0.12 -0.16Z';
	const FLARE_SMALL = 'M0 -1.1L0.1 -0.12L1.1 0L0.1 0.12L0 1.1L-0.1 0.12L-1.1 0L-0.1 -0.12Z';
</script>

{#if variant === 1}
	<!-- A binary pair, round a centre neither of them sits on. -->
	<ellipse class="pair-haze" cx="0" cy="0" rx="1.15" ry="0.8" />
	<g class="pair">
		<g transform="translate(-0.52 0) scale(0.92)">
			<path class="flare" d={FLARE_SMALL} />
			<circle class="star-core" cx="0" cy="0" r={compact ? 0.42 : 0.34} />
		</g>
		<g transform="translate(0.66 0) scale(0.66)">
			<path class="flare flare--small" d={FLARE_SMALL} />
			<circle class="star-core star-core--dim" cx="0" cy="0" r={compact ? 0.3 : 0.24} />
		</g>
	</g>
{:else if variant === 2}
	<!-- One star, one big world, one tilted orbit. -->
	<g transform="rotate(-22)">
		<g transform="scale(1 0.42)">
			<circle class="orbit-line" cx="0" cy="0" r="1.3" />
			{#if !compact}
				<g class="worlds worlds--slow">
					<g transform="translate(1.3 0) scale(1 2.38)">
						<circle class="world" cx="0" cy="0" r="0.26" />
						<ellipse class="world-ring" cx="0" cy="0" rx="0.44" ry="0.14" />
					</g>
				</g>
			{/if}
		</g>
	</g>
	<g transform="scale(0.78)"><path class="flare" d={FLARE} /></g>
	<circle class="star-core" cx="0" cy="0" r={compact ? 0.48 : 0.38} />
{:else}
	<!-- A star with worlds of its own, on rings it keeps. -->
	{#if !compact}
		<circle class="orbit-line" cx="0" cy="0" r="0.74" />
		<circle class="orbit-line" cx="0" cy="0" r="1.18" />
	{/if}
	<path class="flare" d={FLARE} />
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
{/if}

<style>
	.flare {
		fill: var(--lit);
		opacity: 1;
		animation: flare 4.5s ease-in-out infinite;
		animation-play-state: var(--motion, running);
		transform-box: fill-box;
		transform-origin: center;
	}

	.flare--small {
		animation-delay: 1.4s;
		opacity: 0.85;
	}

	.star-core {
		fill: #fffdf2;
	}

	.star-core--dim {
		fill: var(--pale);
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

	.worlds,
	.pair {
		animation: revolve calc(var(--spin) * 0.55) linear infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
	}

	.worlds--outer {
		animation-duration: var(--spin);
		animation-direction: reverse;
	}

	.worlds--slow,
	.pair {
		animation-duration: calc(var(--spin) * 0.9);
	}

	.pair-haze {
		fill: var(--lit);
		opacity: 0.14;
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
</style>
