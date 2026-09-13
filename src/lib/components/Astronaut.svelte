<script lang="ts">
	import type { Mood } from '$domain/mascot';

	/**
	 * The pilot: on empty states and the sign-in screens as a drifting
	 * decoration, and on the focused view as the mascot, where the mood says what
	 * the week looks like.
	 *
	 * Each mood has to read at 160px, so each one changes the pose rather than a
	 * detail — a wrench, an arm out, a taut tether, eyes shut.
	 */
	interface Props {
		size?: number;
		/** Seconds for one full drift cycle. */
		speed?: number;
		/** Set while an orbit has just closed: a salute, and then back to drifting. */
		cheer?: boolean;
		/** `drift` is the decoration; the rest come from the orbits. */
		mood?: Mood | 'drift';
	}

	let { size = 160, speed = 9, cheer = false, mood = 'drift' }: Props = $props();

	/** Out at the end of the line, so the line is straight. */
	const tether = $derived(
		mood === 'adrift' ? 'M60 120 L 2 141' : 'M60 120 C 40 128, 26 134, 8 138'
	);
</script>

<div
	class="astronaut"
	class:is-cheering={cheer}
	data-mood={mood}
	style="--size: {size}px; --speed: {speed}s"
	aria-hidden="true"
>
	<svg viewBox="0 0 120 140">
		<!-- tether -->
		<path class="tether" d={tether} />

		<g class="float">
			<!-- backpack -->
			<rect x="36" y="46" width="48" height="44" rx="14" fill="#8e99c9" />
			<!-- arms -->
			<g class="arm arm--left">
				<rect x="18" y="52" width="20" height="13" rx="6.5" fill="#e7ecff" />
			</g>
			<g class="arm arm--right">
				<rect x="82" y="52" width="20" height="13" rx="6.5" fill="#e7ecff" />
				{#if mood === 'working'}
					<!-- a spanner, held out where the work is -->
					<g class="tool">
						<rect x="98" y="53.5" width="16" height="10" rx="5" fill="#b9c2ee" />
						<path
							d="M116 50a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 1 0-17z"
							fill="#d7ddfb"
							stroke="#8e99c9"
							stroke-width="1.4"
						/>
					</g>
				{/if}
				{#if mood === 'alert'}
					<!-- the finger, and a pulse where it is pointing -->
					<rect x="100" y="55.5" width="9" height="6" rx="3" fill="#f4f6ff" />
					<circle class="point" cx="113" cy="58.5" r="4" fill="#fbbf24" />
				{/if}
			</g>
			<!-- legs -->
			<rect x="44" y="86" width="14" height="30" rx="7" fill="#e7ecff" />
			<rect x="62" y="86" width="14" height="30" rx="7" fill="#e7ecff" />
			<rect x="42" y="110" width="18" height="11" rx="5" fill="#b9c2ee" />
			<rect x="60" y="110" width="18" height="11" rx="5" fill="#b9c2ee" />
			<!-- torso -->
			<rect x="38" y="46" width="44" height="46" rx="16" fill="#f4f6ff" />
			<rect x="52" y="60" width="16" height="12" rx="4" fill="#9aa5d6" />
			<circle cx="56" cy="66" r="2" fill="#34d399" />
			<circle cx="63" cy="66" r="2" fill="#fbbf24" />
			<!-- helmet -->
			<circle cx="60" cy="34" r="25" fill="#f4f6ff" />
			<circle cx="60" cy="34" r="19" fill="#101736" />
			<path
				d="M48 26 Q 56 20, 68 23"
				stroke="rgba(255,255,255,0.5)"
				stroke-width="3"
				fill="none"
				stroke-linecap="round"
			/>
			<circle class="visor-glint" cx="52" cy="40" r="3.5" fill="rgba(167,139,250,0.85)" />
			{#if mood === 'resting'}
				<!-- asleep: shut eyes behind the visor, and the sleep rising off it -->
				<path
					class="eyes"
					d="M52 33q3.5 4 7 0M63 33q3.5 4 7 0"
					stroke="#cbd3f0"
					stroke-width="2"
					fill="none"
					stroke-linecap="round"
				/>
				<g class="sleep">
					<text class="z z--1" x="86" y="22">z</text>
					<text class="z z--2" x="95" y="12">z</text>
				</g>
			{/if}
		</g>
	</svg>
</div>

<style>
	.astronaut {
		max-width: 100%;
		width: var(--size);
	}

	svg {
		height: auto;
		width: 100%;
		overflow: visible;
	}

	.float {
		animation: float var(--speed) ease-in-out infinite;
		transform-origin: 60px 70px;
	}

	.arm {
		transform-origin: 38px 58px;
		animation: wave calc(var(--speed) * 0.55) ease-in-out infinite;
	}

	.arm--right {
		transform-origin: 82px 58px;
		animation-direction: reverse;
	}

	.tether {
		fill: none;
		stroke: rgba(167, 139, 250, 0.5);
		stroke-dasharray: 4 5;
		stroke-linecap: round;
		stroke-width: 2;
		animation: sway calc(var(--speed) * 1.2) ease-in-out infinite;
		transform-origin: 60px 120px;
	}

	.visor-glint {
		animation: glint 6s ease-in-out infinite;
	}

	/* ---- Moods ---------------------------------------------------------- */

	/* Everything closed: floating, arms down, out cold. */
	[data-mood='resting'] .float {
		animation-duration: calc(var(--speed) * 1.6);
	}

	[data-mood='resting'] .arm {
		animation: none;
		transform: rotate(16deg);
	}

	[data-mood='resting'] .arm--right {
		transform: rotate(-16deg);
	}

	[data-mood='resting'] .visor-glint {
		opacity: 0.25;
	}

	.z {
		fill: #cbd3f0;
		font-family: var(--font-body);
		font-size: 14px;
		font-weight: 600;
		animation: sleep 3.4s ease-in-out infinite;
	}

	.z--2 {
		animation-delay: 1.1s;
		font-size: 11px;
	}

	/* On pace: turning something, steadily. The spanner is held up rather than
	   out, so the pose reads differently from the pointing one at sprite size. */
	[data-mood='working'] .arm--right {
		transform: rotate(-24deg);
		animation: work 1.6s ease-in-out infinite;
	}

	[data-mood='working'] .arm--left {
		animation: none;
		transform: rotate(12deg);
	}

	/* Behind with time left: pointing at the orbit that needs the attention. */
	[data-mood='alert'] .arm--right {
		animation: none;
		transform: rotate(38deg);
	}

	[data-mood='alert'] .arm--left {
		animation: none;
		transform: rotate(-10deg);
	}

	.point {
		animation: ping 1.8s ease-out infinite;
		transform-box: fill-box;
		transform-origin: center;
	}

	/* Out of time and well short: at the end of the line, and knowing it. */
	[data-mood='adrift'] .float {
		/* The static pose is what is left when the animation yields to reduced
		   motion, so drifting away still reads as drifting away. */
		transform: translate(8px, -5px) rotate(12deg);
		animation: adrift calc(var(--speed) * 1.3) ease-in-out infinite;
	}

	[data-mood='adrift'] .arm {
		animation: none;
		transform: rotate(-24deg);
	}

	[data-mood='adrift'] .arm--right {
		transform: rotate(24deg);
	}

	[data-mood='adrift'] .tether {
		animation: none;
		stroke: rgba(251, 191, 36, 0.75);
		stroke-dasharray: none;
	}

	/* Someone closed an orbit: a salute and a hop, over before it is in the way. */
	.is-cheering .arm--right {
		animation: salute 900ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.is-cheering .float {
		animation:
			hop 900ms cubic-bezier(0.22, 1, 0.36, 1),
			float var(--speed) ease-in-out infinite;
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0) rotate(-4deg);
		}
		50% {
			transform: translateY(-10px) rotate(4deg);
		}
	}

	@keyframes wave {
		0%,
		100% {
			transform: rotate(-8deg);
		}
		50% {
			transform: rotate(12deg);
		}
	}

	@keyframes sway {
		0%,
		100% {
			transform: rotate(-3deg);
		}
		50% {
			transform: rotate(5deg);
		}
	}

	@keyframes work {
		0%,
		100% {
			transform: rotate(-24deg);
		}
		50% {
			transform: rotate(-4deg);
		}
	}

	@keyframes ping {
		0% {
			opacity: 0.9;
			transform: scale(0.7);
		}
		70%,
		100% {
			opacity: 0;
			transform: scale(1.9);
		}
	}

	@keyframes sleep {
		0% {
			opacity: 0;
			transform: translate(0, 4px);
		}
		35% {
			opacity: 0.9;
		}
		100% {
			opacity: 0;
			transform: translate(6px, -10px);
		}
	}

	@keyframes adrift {
		0%,
		100% {
			transform: translate(4px, -2px) rotate(9deg);
		}
		50% {
			transform: translate(12px, -8px) rotate(15deg);
		}
	}

	@keyframes salute {
		0% {
			transform: rotate(0deg);
		}
		25%,
		65% {
			transform: rotate(-62deg);
		}
		100% {
			transform: rotate(0deg);
		}
	}

	@keyframes hop {
		0%,
		100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-9px);
		}
	}

	@keyframes glint {
		0%,
		80%,
		100% {
			opacity: 0.35;
		}
		88% {
			opacity: 1;
		}
	}
</style>
