<script lang="ts">
	/** Nova's mark: a small rocket with a flickering exhaust. */
	interface Props {
		size?: number;
		/** Adds a launch bob, for hero placements. */
		launching?: boolean;
	}

	let { size = 48, launching = false }: Props = $props();
</script>

<div class="rocket" class:rocket--launching={launching} style="--size: {size}px" aria-hidden="true">
	<svg viewBox="0 0 48 64">
		<g class="flame">
			<path d="M24 44 C 17 52, 19 62, 24 64 C 29 62, 31 52, 24 44 Z" fill="#fbbf24" />
			<path d="M24 48 C 20 54, 21 59, 24 61 C 27 59, 28 54, 24 48 Z" fill="#fb7185" />
		</g>
		<path d="M24 2 C 34 12, 38 28, 36 46 H 12 C 10 28, 14 12, 24 2 Z" fill="#f4f6ff" />
		<path d="M12 46 C 4 44, 2 36, 8 28 L 14 40 Z" fill="#a78bfa" />
		<path d="M36 46 C 44 44, 46 36, 40 28 L 34 40 Z" fill="#a78bfa" />
		<circle cx="24" cy="24" r="7" fill="#101736" />
		<circle cx="24" cy="24" r="4.5" fill="#7dd3fc" />
		<circle cx="22" cy="22" r="1.4" fill="rgba(255,255,255,0.85)" />
	</svg>
</div>

<style>
	.rocket {
		width: var(--size);
	}

	svg {
		height: auto;
		width: 100%;
		overflow: visible;
	}

	.rocket--launching {
		animation: hover 4s ease-in-out infinite;
	}

	.flame {
		transform-box: fill-box;
		transform-origin: top center;
		animation: flicker 260ms ease-in-out infinite alternate;
	}

	@keyframes flicker {
		from {
			opacity: 0.75;
			transform: scaleY(0.85);
		}
		to {
			opacity: 1;
			transform: scaleY(1.15);
		}
	}

	@keyframes hover {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-8px);
		}
	}
</style>
