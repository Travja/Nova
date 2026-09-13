<script lang="ts">
	/** A drifting astronaut, used to fill empty states and the sign-in screens. */
	interface Props {
		size?: number;
		/** Seconds for one full drift cycle. */
		speed?: number;
		/** Set while an orbit has just closed: a salute, and then back to drifting. */
		cheer?: boolean;
	}

	let { size = 160, speed = 9, cheer = false }: Props = $props();
</script>

<div
	class="astronaut"
	class:is-cheering={cheer}
	style="--size: {size}px; --speed: {speed}s"
	aria-hidden="true"
>
	<svg viewBox="0 0 120 140">
		<!-- tether -->
		<path class="tether" d="M60 120 C 40 128, 26 134, 8 138" />

		<g class="float">
			<!-- backpack -->
			<rect x="36" y="46" width="48" height="44" rx="14" fill="#8e99c9" />
			<!-- arms -->
			<g class="arm arm--left">
				<rect x="18" y="52" width="20" height="13" rx="6.5" fill="#e7ecff" />
			</g>
			<g class="arm arm--right">
				<rect x="82" y="52" width="20" height="13" rx="6.5" fill="#e7ecff" />
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
		</g>
	</svg>
</div>

<style>
	.astronaut {
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
