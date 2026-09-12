<script lang="ts">
	import type { Orbit } from '$domain/progress';

	/** The last handful of orbits as small rings — a streak you can read at a glance. */
	interface Props {
		history: readonly Orbit[];
		color: string;
	}

	let { history, color }: Props = $props();

	const RADIUS = 9;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	/** Oldest first reads like a timeline. */
	const ordered = $derived([...history].reverse());

	function shortLabel(orbit: Orbit): string {
		const [, value] = orbit.period.key.split(':');
		return value;
	}
</script>

<ol class="history" style="--color: {color}">
	{#each ordered as orbit, index (orbit.period.key)}
		<li class:is-current={index === ordered.length - 1}>
			<svg
				viewBox="0 0 24 24"
				role="img"
				aria-label="{shortLabel(orbit)}: {Math.round(orbit.fraction * 100)}%"
			>
				<circle class="track" cx="12" cy="12" r={RADIUS} />
				<circle
					class="fill"
					class:complete={orbit.complete}
					cx="12"
					cy="12"
					r={RADIUS}
					stroke-dasharray={CIRCUMFERENCE}
					stroke-dashoffset={CIRCUMFERENCE * (1 - orbit.fraction)}
				/>
			</svg>
			<span class="label muted">{shortLabel(orbit)}</span>
		</li>
	{/each}
</ol>

<style>
	.history {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: grid;
		gap: 0.2rem;
		justify-items: center;
		opacity: 0.75;
	}

	li.is-current {
		opacity: 1;
	}

	svg {
		height: 2rem;
		width: 2rem;
	}

	.track {
		fill: none;
		stroke: rgba(148, 163, 214, 0.2);
		stroke-width: 2.4;
	}

	.fill {
		fill: none;
		stroke: var(--color);
		stroke-linecap: round;
		stroke-width: 2.4;
		transform: rotate(-90deg);
		transform-origin: 12px 12px;
		opacity: 0.7;
	}

	.fill.complete {
		opacity: 1;
		filter: drop-shadow(0 0 3px var(--color));
	}

	.label {
		font-size: 0.62rem;
		letter-spacing: 0.02em;
	}
</style>
