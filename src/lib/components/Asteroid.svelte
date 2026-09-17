<script lang="ts">
	import type { DriftBand } from '$domain/asteroids';

	/**
	 * One rock, drawn where its drift has taken it.
	 *
	 * The belt is matter that never coalesced into an orbiting body, which is
	 * exactly what a one-off is next to a goal — so this is deliberately not a
	 * dial. There is no arc to fill and no body travelling round to meet it,
	 * because there is no period and nothing to complete. What there is instead
	 * is a distance: the faint track on the left is the orbit this rock never
	 * joined, and the further right it sits the longer nobody has touched it.
	 *
	 * Quieter than a closing orbit, always. A revolution closing is the biggest
	 * moment in the app; this is a stone turning over in the dark.
	 *
	 * The shape is seeded from the asteroid's id, so every rock is its own rock
	 * and the server and the browser draw the same one — `Math.random()` here
	 * would be a hydration mismatch per vertex.
	 *
	 * The box is wider than it is tall because the drift is horizontal, and the
	 * height is computed from the width at the viewBox's own ratio rather than
	 * set independently — an SVG whose two scales disagree draws every circle
	 * in it as an ellipse, so the units below can stay units.
	 */

	interface Props {
		/** The asteroid's id — the seed, so a rock keeps its shape. */
		seed: string;
		/** How far out it has drifted, 0 at the inner edge and 1 at the outer. */
		drift: number;
		band: DriftBand;
		/** Width in pixels; the height follows from the viewBox. */
		size?: number;
	}

	let { seed, drift, band, size = 76 }: Props = $props();

	/** The box the geometry below is written in. */
	const BOX = { width: 120, height: 64 };

	/** FNV-1a, so two ids that differ by a character do not draw the same rock. */
	function hash(value: string): number {
		let h = 2_166_136_261;
		for (let index = 0; index < value.length; index += 1) {
			h ^= value.charCodeAt(index);
			h = Math.imul(h, 16_777_619);
		}
		return h >>> 0;
	}

	/** The same generator the starfield seeds itself with. */
	function seeded(start: number) {
		let state = start % 2_147_483_648;
		return () => {
			state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
			return state / 2_147_483_648;
		};
	}

	const VERTICES = 9;
	const RADIUS = 18;

	interface Crater {
		x: number;
		y: number;
		r: number;
	}

	interface Rock {
		points: string;
		craters: Crater[];
		/** Seconds per turn, so a belt of rocks does not tumble in lockstep. */
		spin: number;
		clockwise: boolean;
	}

	function carve(id: string): Rock {
		const random = seeded(hash(id));

		const points = Array.from({ length: VERTICES }, (_, index) => {
			const angle = (index / VERTICES) * Math.PI * 2;
			const radius = RADIUS * (0.74 + random() * 0.46);
			return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
		}).join(' ');

		const craters = Array.from({ length: 3 }, () => {
			const angle = random() * Math.PI * 2;
			const distance = random() * RADIUS * 0.55;
			return {
				x: Number((Math.cos(angle) * distance).toFixed(2)),
				y: Number((Math.sin(angle) * distance).toFixed(2)),
				r: Number((1.4 + random() * 2.2).toFixed(2))
			};
		});

		return { points, craters, spin: Math.round(72 + random() * 58), clockwise: random() > 0.5 };
	}

	const rock = $derived(carve(seed));
	/** Clamped here too: a stray fraction must not put a rock outside its box. */
	const travelled = $derived(Math.min(1, Math.max(0, drift)));
	/** Inner edge of the belt to its outer reach, in the box's own units. */
	const cx = $derived(34 + travelled * 64);
</script>

<svg
	class="asteroid"
	data-band={band}
	viewBox="0 0 {BOX.width} {BOX.height}"
	width={size}
	height={(size * BOX.height) / BOX.width}
	role="presentation"
	style="--spin: {rock.spin}s; --turn: {rock.clockwise ? '360deg' : '-360deg'}"
>
	<!-- The orbit it never joined. Always the same weight, whatever the drift:
	     it is the thing being drifted away from, so it cannot fade too. -->
	<path class="track" d="M 10 5 A 42 42 0 0 1 10 59" />

	<!-- How far it has come. The dots stop where the rock is, so length and
	     position are the same fact rather than two that can disagree. -->
	<path class="wake" d="M 22 32 L {cx.toFixed(2)} 32" />

	<g class="rock" transform="translate({cx.toFixed(2)} 32)">
		<polygon class="rock__body" points={rock.points} />
		{#each rock.craters as crater, index (index)}
			<circle class="rock__crater" cx={crater.x} cy={crater.y} r={crater.r} />
		{/each}
	</g>
</svg>

<style>
	.asteroid {
		display: block;
		flex: none;
		overflow: visible;
	}

	.track {
		fill: none;
		stroke: var(--space-border);
		stroke-dasharray: 3 6;
		stroke-linecap: round;
		stroke-width: 2;
	}

	.wake {
		fill: none;
		stroke: var(--rock-wake);
		stroke-dasharray: 0.5 6;
		stroke-linecap: round;
		stroke-width: 2;
	}

	/*
	 * Turning about its own centre, which `fill-box` gives without the transform
	 * having to repeat the coordinates the `translate` above already carries.
	 * One turn every minute or two: slow enough that it reads as a rock adrift
	 * rather than as something asking to be looked at.
	 */
	.rock {
		animation: tumble var(--spin) linear infinite;
		transform-box: fill-box;
		transform-origin: center;
	}

	.rock__body {
		fill: var(--rock-face);
		stroke: var(--rock-edge);
		stroke-linejoin: round;
		stroke-width: 1.4;
	}

	.rock__crater {
		fill: var(--rock-pit);
	}

	/*
	 * Three stages of being let be. Stone rather than an accent colour: the
	 * accents belong to tiers and to closing orbits, and a rock that borrowed
	 * one would be competing with them.
	 */
	.asteroid[data-band='fresh'] {
		--rock-face: rgba(160, 172, 214, 0.9);
		--rock-edge: rgba(226, 232, 255, 0.75);
		--rock-pit: rgba(60, 70, 110, 0.55);
		--rock-wake: rgba(148, 163, 214, 0.3);
	}

	.asteroid[data-band='drifting'] {
		--rock-face: rgba(132, 144, 186, 0.62);
		--rock-edge: rgba(202, 210, 240, 0.5);
		--rock-pit: rgba(50, 58, 96, 0.45);
		--rock-wake: rgba(148, 163, 214, 0.24);
	}

	/*
	 * Dimmer again, but still a rock. Faint has to read as distance rather than
	 * as something broken, so there is a floor under how far it fades.
	 */
	.asteroid[data-band='faint'] {
		--rock-face: rgba(120, 132, 172, 0.42);
		--rock-edge: rgba(196, 205, 236, 0.38);
		--rock-pit: rgba(46, 54, 90, 0.32);
		--rock-wake: rgba(148, 163, 214, 0.18);
	}

	@keyframes tumble {
		to {
			transform: rotate(var(--turn));
		}
	}
</style>
