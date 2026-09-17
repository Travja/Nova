<script lang="ts">
	import type { DriftBand } from '$domain/asteroids';

	/**
	 * One rock, drawn against the belt it belongs to.
	 *
	 * The belt is matter that never coalesced into an orbiting body, which is
	 * exactly what a one-off is next to a goal — so this is deliberately not a
	 * dial. There is no arc to fill and no body travelling round to meet it,
	 * because there is no period and nothing to complete. What there is instead
	 * is a *distance*, and a distance needs two things to be a distance: the
	 * swarm on the left is the belt proper, and the rock is however far out of
	 * it nobody has touched this one.
	 *
	 * The swarm is seeded from a constant rather than from the asteroid, so
	 * every row draws the same belt — it is the same belt. Only the rock is the
	 * row's own, seeded from its id so the server and the browser carve the same
	 * stone; `Math.random()` here would be a hydration mismatch per vertex.
	 *
	 * A rock that is `settled` is drawn back among the swarm instead of out
	 * beyond it, which is the whole of what the Done fold means: finished, and
	 * no longer drifting away from anything.
	 *
	 * Quieter than a closing orbit, always. A revolution closing is the biggest
	 * moment in the app; this is a stone turning over in the dark.
	 *
	 * The box is wider than it is tall because the drift is horizontal, and the
	 * height follows from the width at the viewBox's own ratio rather than being
	 * set independently — an SVG whose two scales disagree draws every circle in
	 * it as an ellipse, so the units below can stay units.
	 *
	 * How wide is `--mark-width`, set by whoever is drawing the row rather than
	 * passed in as a number. Compact is a different shape and not the same one
	 * scaled down, so the density that decides a row's shape is the thing that
	 * should decide its mark — and that decision lives in CSS, where the rest of
	 * density already lives.
	 */

	interface Props {
		/** The asteroid's id — the seed, so a rock keeps its shape. */
		seed: string;
		/** How far out it has drifted, 0 at the inner edge and 1 at the outer. */
		drift: number;
		band: DriftBand;
		/** Finished: drawn back in the swarm rather than out beyond it. */
		settled?: boolean;
	}

	let { seed, drift, band, settled = false }: Props = $props();

	/**
	 * Two boxes, not one.
	 *
	 * The belt has to run the whole height of whatever row it is in, and the
	 * rock has to keep its horizontal position exactly — one element cannot do
	 * both, because stretching a viewBox to fill a variable height either
	 * squashes every circle in it or crops the side the rock drifts towards. So
	 * the strip is its own element, scaled uniformly to cover the row and
	 * cropped top and bottom (which is what a belt does anyway — it carries on
	 * past the card), and the rock sits in a fixed box laid over it.
	 */
	const STRIP = { width: 34, height: 170 };
	const BOX = { width: 96, height: 48 };

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

	/*
	 * The swarm: a long, gently bowed band of rubble down the left of the strip.
	 *
	 * Bowed rather than straight because a belt is an orbit that never gathered
	 * itself up, and the curve is the only thing left on screen still saying so.
	 * The bow is written as a sagitta rather than as a circle's centre and
	 * radius: over a band this tall the radius that gives a subtle curve is in
	 * the thousands, and a number nobody can picture is a number nobody can
	 * tune.
	 */
	const SWARM = {
		seed: 20_260_930,
		count: 130,
		/** The band's near edge at its widest point, and how far across it runs. */
		x: 10,
		width: 22,
		/** How far the band leans back towards the card's edge at top and bottom. */
		bow: 9
	};

	interface Speck {
		x: number;
		y: number;
		r: number;
		o: number;
	}

	function swarm(): Speck[] {
		const random = seeded(SWARM.seed);

		return Array.from({ length: SWARM.count }, () => {
			// -1 at the top of the strip, 1 at the bottom.
			const along = random() * 2 - 1;
			// Two draws averaged rather than one, so the band is thick through the
			// middle and thins at its edges. A flat scatter reads as noise; this
			// reads as a belt seen edge-on.
			const across = (random() + random()) / 2;
			return {
				x: Number((SWARM.x + across * SWARM.width - SWARM.bow * along * along).toFixed(2)),
				y: Number(((along + 1) * 0.5 * STRIP.height).toFixed(2)),
				r: Number((0.9 + random() * 2).toFixed(2)),
				o: Number((0.45 + random() * 0.5).toFixed(2))
			};
		});
	}

	/** Every row's belt is the same belt, so it is carved once for the module. */
	const specks = swarm();

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
	/**
	 * Where the rock sits. Settled puts it in the swarm; otherwise it starts
	 * clear of the swarm's outer edge and runs to the far side of the box, so
	 * "out of the belt" is true of the drawing before it is true of the words.
	 */
	/*
	 * The far end stops short of the box's edge by the rock's own reach, so the
	 * most drifted rock is still a whole rock rather than one clipped by the
	 * title beside it.
	 */
	const cx = $derived(settled ? 20 : 46 + travelled * 30);
	const cy = $derived(BOX.height / 2);
	/**
	 * A settled rock is drawn smaller. It is back among the rubble and no longer
	 * the thing being measured — the row it belongs to is a line in a fold, not
	 * a card — so it takes the room a line can spare.
	 */
	const scale = $derived(settled ? 0.6 : 1);
</script>

<span
	class="asteroid"
	class:asteroid--settled={settled}
	data-band={band}
	style="--spin: {rock.spin}s; --turn: {rock.clockwise ? '360deg' : '-360deg'}"
>
	<!-- The belt itself: the same swarm in every row, at the same weight
	     whatever this rock is doing. It is the thing being drifted away from,
	     so it cannot fade along with the rock that left it. `slice` scales it
	     to cover the row and crops the overflow, which is how it runs the whole
	     height of a card of any size without a single circle going oval. -->
	<svg
		class="strip"
		viewBox="0 0 {STRIP.width} {STRIP.height}"
		preserveAspectRatio="xMidYMid slice"
		role="presentation"
	>
		{#each specks as speck, index (index)}
			<circle cx={speck.x} cy={speck.y} r={speck.r} opacity={speck.o} />
		{/each}
	</svg>

	<svg class="mark" viewBox="0 0 {BOX.width} {BOX.height}" role="presentation">
		{#if !settled}
			<!-- How far it has come. The dots run from the swarm's edge and stop
			     where the rock is, so length and position are the same fact rather
			     than two that can disagree. -->
			<path class="wake" d="M 36 {cy} L {cx.toFixed(2)} {cy}" />
		{/if}

		<g class="rock" transform="translate({cx.toFixed(2)} {cy}) scale({scale})">
			<polygon class="rock__body" points={rock.points} />
			{#each rock.craters as crater, index (index)}
				<circle class="rock__crater" cx={crater.x} cy={crater.y} r={crater.r} />
			{/each}
		</g>
	</svg>
</span>

<style>
	/*
	 * The mark is a fixed width and whatever height the row turns out to be —
	 * `align-self: stretch` on the row's side — so the belt runs the full card
	 * rather than sitting in a band across the top of it.
	 */
	.asteroid {
		align-items: center;
		display: flex;
		flex: none;
		position: relative;
		width: var(--mark-width, 72px);
	}

	/*
	 * `height: 100%` rather than `top: 0; bottom: 0`. An SVG carrying a viewBox
	 * is a replaced element with an intrinsic aspect ratio, and that ratio wins
	 * over a pair of offsets — which sized the strip from its own proportions
	 * and spilled it out of the bottom of every card. `slice` then scales it
	 * uniformly to cover the row and crops the rest, which is what a belt does
	 * anyway: it carries on past the card.
	 */
	.strip {
		height: 100%;
		left: 0;
		overflow: hidden;
		position: absolute;
		top: 0;
		/* The strip's share of the mark, kept in the same proportion the two
		   viewBoxes are written in, so one number sets both. */
		width: calc(var(--mark-width, 72px) * 34 / 96);
	}

	/* Over the strip, so a settled rock sits among the rubble rather than
	   behind it. */
	.mark {
		display: block;
		/* The rock reaches a little past its box at full drift; the row has a
		   gap there for it. */
		overflow: visible;
		position: relative;
		width: 100%;
	}

	/*
	 * Stone, like the rock, rather than an accent: the belt is the context a
	 * row is read against and must not compete with anything on the page above
	 * it. Bright enough to be a band, dim enough to stay background.
	 */
	.strip {
		fill: rgba(198, 207, 238, 0.55);
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

	/* Back in the swarm and not going anywhere: nothing left to be adrift. */
	.asteroid--settled .rock {
		animation: none;
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

	/*
	 * Settled last, so it wins over the band blocks above at equal specificity.
	 *
	 * Opaque, where a drifting rock is not: at 90% the rubble behind shows
	 * straight through the stone, and a rock you can see the belt through reads
	 * as part of the belt rather than as something sitting in front of it. The
	 * edge is brighter for the same reason — it is the line that says which of
	 * the two you are looking at.
	 */
	.asteroid--settled {
		--rock-face: rgb(172, 184, 222);
		--rock-edge: rgba(242, 246, 255, 0.92);
		--rock-pit: rgba(52, 60, 98, 0.6);
	}

	@keyframes tumble {
		to {
			transform: rotate(var(--turn));
		}
	}
</style>
