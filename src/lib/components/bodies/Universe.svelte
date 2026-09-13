<script module lang="ts">
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

	function field(seed: number, count: number, spread: number): FarStar[] {
		const random = seeded(seed);
		return Array.from({ length: count }, (_, index) => {
			const angle = random() * Math.PI * 2;
			// Square-rooting the radius spreads the stars evenly over the disc
			// instead of piling them into the middle.
			const radius = Math.sqrt(random()) * spread;
			return {
				x: Number((Math.cos(angle) * radius).toFixed(3)),
				y: Number((Math.sin(angle) * radius).toFixed(3)),
				size: Number((0.05 + random() * 0.07).toFixed(3)),
				delay: Number((random() * 4).toFixed(2)),
				near: index % 5 === 0
			};
		});
	}

	const FIELD = field(52_711, 18, 0.82);
	const NEBULA_FIELD = field(9_431, 12, 0.78);
	/** The web's nodes, and the filaments running between neighbours. */
	const NODES = field(31_337, 8, 0.72);
	const FILAMENTS = NODES.map((node, index) => {
		const next = NODES[(index + 1) % NODES.length];
		return `M${node.x} ${node.y}L${next.x} ${next.y}`;
	}).join('');
</script>

<script lang="ts">
	/**
	 * Universes: a field of distant light, a nebula, and the cosmic web.
	 *
	 * All three keep the dark disc and the bright rim, which is what says
	 * "everything" at any size.
	 */
	interface Props {
		variant: number;
		compact: boolean;
	}

	let { variant, compact }: Props = $props();

	const stars = $derived.by(() => {
		const source = variant === 1 ? NEBULA_FIELD : FIELD;
		return compact ? source.filter((star) => star.near) : source;
	});
	const scale = $derived(compact ? 2 : 1.35);
</script>

<circle class="void" cx="0" cy="0" r="1" />

{#if variant === 1}
	<!-- A nebula: light with something in the way of it. -->
	<ellipse class="cloud" cx="-0.26" cy="-0.2" rx="0.86" ry="0.68" transform="rotate(-20)" />
	<ellipse
		class="cloud cloud--pale"
		cx="0.32"
		cy="0.28"
		rx="0.66"
		ry="0.5"
		transform="rotate(24)"
	/>
	<ellipse class="cloud cloud--core" cx="0.02" cy="0" rx="0.4" ry="0.3" />
{:else if variant === 2}
	<!-- The cosmic web: everything, and the threads it hangs on. -->
	<path class="filament" d={FILAMENTS} />
	{#each NODES as node, index (index)}
		<circle
			class="node"
			cx={node.x}
			cy={node.y}
			r={(compact ? 0.15 : 0.11) + (index % 3 === 0 ? 0.05 : 0)}
		/>
	{/each}
{:else}
	<circle class="haze" cx="0" cy="0" r="0.92" />
{/if}

{#each stars as star, index (index)}
	<circle
		class="far-star"
		cx={star.x}
		cy={star.y}
		r={star.size * scale}
		style="--twinkle-delay: {star.delay}s"
	/>
{/each}

<circle class="rim" cx="0" cy="0" r="1" />

<style>
	.void {
		fill: #0a0f26;
	}

	.haze {
		fill: var(--lit);
		opacity: 0.22;
	}

	.cloud {
		fill: var(--lit);
		opacity: 0.5;
	}

	.cloud--pale {
		fill: var(--pale);
		opacity: 0.32;
	}

	.cloud--core {
		fill: var(--pale);
		opacity: 0.6;
	}

	.filament {
		fill: none;
		stroke: var(--pale);
		stroke-width: 0.06;
		opacity: 0.85;
	}

	.node {
		fill: var(--pale);
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
