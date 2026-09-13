<script lang="ts">
	/**
	 * Satellites: the small things that come round every day. A comsat with
	 * panels, a cratered moon, and a dish probe.
	 *
	 * Everything is drawn inside a unit circle centred on the origin; `TierBody`
	 * scales it into place and sets the colours.
	 */
	interface Props {
		variant: number;
		compact: boolean;
	}

	let { variant, compact }: Props = $props();

	const uid = $props.id();
</script>

{#if variant === 1}
	<!-- A cratered moon. -->
	<clipPath id="moon-{uid}"><circle cx="0" cy="0" r="1" /></clipPath>
	<circle class="moon" cx="0" cy="0" r="1" />
	<g clip-path="url(#moon-{uid})">
		{#if compact}
			<ellipse class="crater" cx="-0.28" cy="-0.26" rx="0.42" ry="0.38" />
			<ellipse class="crater" cx="0.3" cy="0.34" rx="0.3" ry="0.27" />
		{:else}
			<ellipse class="crater" cx="-0.34" cy="-0.3" rx="0.34" ry="0.3" />
			<ellipse class="crater" cx="0.26" cy="0.14" rx="0.24" ry="0.21" />
			<ellipse class="crater" cx="-0.1" cy="0.52" rx="0.17" ry="0.15" />
			<ellipse class="crater crater--faint" cx="0.46" cy="-0.5" rx="0.2" ry="0.17" />
			<circle class="shade" cx="1.05" cy="0.2" r="1" />
		{/if}
	</g>
{:else if variant === 2}
	<!-- A probe, most of it dish. -->
	{#if compact}
		<path class="dish" d="M-1.15 -0.5A1.1 1.1 0 0 1 0.55 -1.05L-0.3 0.15Z" />
		<circle class="hull" cx="0.35" cy="0.45" r="0.55" />
	{:else}
		<g class="rock">
			<path class="strut" d="M-0.35 -0.3L0.3 0.4" />
			<ellipse
				class="dish"
				cx="-0.62"
				cy="-0.58"
				rx="0.98"
				ry="0.56"
				transform="rotate(-32 -0.62 -0.58)"
			/>
			<ellipse
				class="dish-bowl"
				cx="-0.62"
				cy="-0.58"
				rx="0.58"
				ry="0.26"
				transform="rotate(-32 -0.62 -0.58)"
			/>
			<circle class="feed" cx="-0.62" cy="-0.58" r="0.13" />
			<rect class="panel" x="0.92" y="0.3" width="0.78" height="0.44" rx="0.12" />
			<rect class="hull" x="0.06" y="0.24" width="0.9" height="0.78" rx="0.24" />
			<circle class="beacon" cx="0.5" cy="0.16" r="0.15" />
		</g>
	{/if}
{:else}
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
{/if}

<style>
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

	.dish-bowl {
		fill: var(--deep);
		opacity: 0.8;
	}

	.feed {
		fill: var(--pale);
	}

	.beacon {
		fill: #fff6d8;
		animation: blink 2.6s steps(1, end) infinite;
		animation-play-state: var(--motion, running);
	}

	.moon {
		fill: var(--lit);
	}

	.crater {
		fill: var(--deep);
		opacity: 0.75;
	}

	.crater--faint {
		opacity: 0.45;
	}

	.shade {
		fill: var(--shadow);
		opacity: 0.5;
	}

	.rock {
		animation: rock calc(var(--spin) * 0.7) ease-in-out infinite;
		animation-play-state: var(--motion, running);
		transform-origin: 0 0;
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
</style>
