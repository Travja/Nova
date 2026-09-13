<script lang="ts">
	/**
	 * Planets: a banded gas giant, a ringed world, and an ice world with a cap.
	 *
	 * The bands drift rather than spin. Two dimensions can only suggest rotation,
	 * and a slow drift suggests it honestly.
	 */
	interface Props {
		variant: number;
		compact: boolean;
	}

	let { variant, compact }: Props = $props();

	const uid = $props.id();
	/** The ringed world sits inside its ring, so the sphere gives up some radius. */
	const radius = $derived(variant === 1 ? 0.82 : 1);
</script>

<clipPath id="planet-{uid}"><circle cx="0" cy="0" r={radius} /></clipPath>

{#if variant === 1}
	<!-- A ringed world: the ring passes behind, then in front. -->
	<clipPath id="front-{uid}"><rect x="-2" y="0" width="4" height="2" /></clipPath>
	<g transform="rotate(-17)">
		<ellipse class="ring" cx="0" cy="0" rx="1.62" ry="0.44" />
	</g>
{/if}

<circle class="surface" cx="0" cy="0" r={radius} />

<g clip-path="url(#planet-{uid})">
	{#if variant === 2}
		<!-- An ice world: a cap at the pole and seas below it. -->
		<ellipse class="cap" cx="-0.08" cy={-radius} rx="1" ry="0.66" />
		{#if !compact}
			<ellipse class="sea" cx="0.1" cy="0.16" rx="0.56" ry="0.34" transform="rotate(16 0.1 0.16)" />
			<ellipse class="sea sea--faint" cx="-0.5" cy="0.46" rx="0.32" ry="0.22" />
			<ellipse class="cap cap--south" cx="0.16" cy={radius} rx="0.86" ry="0.44" />
		{/if}
	{:else if compact}
		<ellipse class="band band--dark" cx="0" cy="0.06" rx="1.4" ry="0.3" />
		<ellipse class="band band--pale" cx="0" cy="-0.58" rx="1.4" ry="0.22" />
	{:else}
		<g class="bands">
			<ellipse class="band band--pale" cx="0" cy={-0.62 * radius} rx="1.6" ry={0.2 * radius} />
			<ellipse class="band band--dark" cx="0" cy={-0.22 * radius} rx="1.7" ry={0.17 * radius} />
			<ellipse class="band band--pale" cx="0" cy={0.16 * radius} rx="1.7" ry={0.24 * radius} />
			<ellipse class="band band--dark" cx="0" cy={0.58 * radius} rx="1.5" ry={0.15 * radius} />
			{#if variant === 0}
				<ellipse class="spot" cx="-0.34" cy="0.2" rx="0.3" ry="0.16" />
			{/if}
		</g>
	{/if}
	<circle class="terminator" cx={1.12 * radius} cy="0.22" r={radius} />
</g>

{#if variant === 1}
	<g transform="rotate(-17)" clip-path="url(#front-{uid})">
		<ellipse class="ring" cx="0" cy="0" rx="1.62" ry="0.44" />
	</g>
{/if}

<style>
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

	.cap {
		fill: #f2f6ff;
		opacity: 0.92;
	}

	.cap--south {
		opacity: 0.75;
	}

	.sea {
		fill: var(--deep);
		opacity: 0.55;
	}

	.sea--faint {
		opacity: 0.4;
	}

	.ring {
		fill: none;
		stroke: var(--pale);
		stroke-width: 0.16;
		opacity: 0.9;
	}

	.terminator {
		fill: var(--shadow);
		opacity: 0.55;
	}

	@keyframes drift {
		from {
			transform: translateX(-0.28px);
		}
		to {
			transform: translateX(0.28px);
		}
	}
</style>
