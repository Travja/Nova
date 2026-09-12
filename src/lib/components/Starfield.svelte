<script lang="ts">
	/**
	 * The backdrop for every screen: three parallax star layers and a slow
	 * nebula drift.
	 *
	 * Stars are positioned as a percentage but sized in pixels, so they stay
	 * round at every aspect ratio. Positions come from a seeded generator so the
	 * server and the browser agree during hydration.
	 */

	interface Props {
		/** Higher values give a denser sky. */
		density?: number;
	}

	let { density = 1 }: Props = $props();

	function seeded(seed: number) {
		let state = seed;
		return () => {
			state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
			return state / 2_147_483_648;
		};
	}

	interface Star {
		x: number;
		y: number;
		size: number;
		opacity: number;
		delay: number;
	}

	function layer(seed: number, count: number, maxSize: number): Star[] {
		const random = seeded(seed);
		return Array.from({ length: Math.round(count * density) }, () => ({
			x: random() * 100,
			y: random() * 100,
			size: 0.8 + random() * maxSize,
			opacity: 0.3 + random() * 0.6,
			delay: random() * 6
		}));
	}

	const layers = [
		{ stars: layer(7, 90, 0.9), drift: 300, opacity: 0.5 },
		{ stars: layer(4_099, 46, 1.3), drift: 190, opacity: 0.75 },
		{ stars: layer(90_210, 16, 1.9), drift: 110, opacity: 1 }
	];
</script>

<div class="starfield" aria-hidden="true">
	<div class="nebula nebula--violet"></div>
	<div class="nebula nebula--teal"></div>
	{#each layers as { stars, drift, opacity }, index (index)}
		<div class="layer" style="--drift: {drift}s; --layer-opacity: {opacity}">
			{#each stars as star, starIndex (starIndex)}
				<span
					class="star"
					style="left: {star.x}%; top: {star.y}%; --size: {star.size}px; --star-opacity: {star.opacity}; --twinkle-delay: {star.delay}s"
				></span>
			{/each}
		</div>
	{/each}
	<div class="shooting-star"></div>
</div>

<style>
	.starfield {
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		position: fixed;
		z-index: -1;
		background:
			radial-gradient(120% 80% at 50% -10%, #16204d 0%, transparent 60%),
			linear-gradient(180deg, #070b1e 0%, #04050d 70%);
	}

	.layer {
		height: 130%;
		left: 0;
		opacity: var(--layer-opacity);
		position: absolute;
		top: -15%;
		width: 100%;
		animation: drift var(--drift) linear infinite alternate;
	}

	.star {
		background: #fff;
		border-radius: 50%;
		height: var(--size);
		opacity: var(--star-opacity);
		position: absolute;
		width: var(--size);
		animation: twinkle 4.5s ease-in-out infinite;
		animation-delay: var(--twinkle-delay);
	}

	.nebula {
		border-radius: 50%;
		filter: blur(60px);
		position: absolute;
	}

	.nebula--violet {
		background: radial-gradient(circle, rgba(124, 92, 240, 0.3), transparent 70%);
		height: 60vmin;
		left: -10vmin;
		top: -8vmin;
		width: 60vmin;
		animation: breathe 26s ease-in-out infinite;
	}

	.nebula--teal {
		background: radial-gradient(circle, rgba(45, 212, 191, 0.14), transparent 70%);
		bottom: -14vmin;
		height: 52vmin;
		right: -12vmin;
		width: 52vmin;
		animation: breathe 34s ease-in-out infinite reverse;
	}

	.shooting-star {
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.9), transparent);
		border-radius: 999px;
		height: 2px;
		opacity: 0;
		position: absolute;
		right: 12%;
		top: 14%;
		width: 90px;
		animation: shoot 17s ease-in infinite;
	}

	@keyframes drift {
		from {
			transform: translate3d(0, 0, 0);
		}
		to {
			transform: translate3d(-1.5%, 4%, 0);
		}
	}

	@keyframes twinkle {
		0%,
		100% {
			opacity: calc(var(--star-opacity) * 0.35);
		}
		50% {
			opacity: var(--star-opacity);
		}
	}

	@keyframes breathe {
		0%,
		100% {
			transform: scale(1) translate(0, 0);
		}
		50% {
			transform: scale(1.18) translate(2%, 3%);
		}
	}

	@keyframes shoot {
		0%,
		92% {
			opacity: 0;
			transform: translate(0, 0) rotate(18deg);
		}
		94% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(-60vw, 42vh) rotate(18deg);
		}
	}
</style>
