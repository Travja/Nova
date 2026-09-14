<script lang="ts">
	import { resolve } from '$app/paths';
	import { ORBIT_METRIC } from '$domain/nesting';
	import { formatAmount, type ChildStanding, type Orbit } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';

	/**
	 * What a derived goal is made of: the goals feeding it, and what each has
	 * closed in the period in flight.
	 *
	 * The dial says the same thing in bodies and angles — this is the half you
	 * can read, and the half that survives a dial too small to carry four moons.
	 * Both are drawn from the same `ChildStanding`, so they cannot disagree.
	 */

	interface Props {
		children: readonly ChildStanding[];
		/** The parent's own orbit, for the sentence above the list. */
		orbit: Orbit;
	}

	let { children, orbit }: Props = $props();

	const closed = $derived(children.reduce((count, child) => count + child.closed, 0));
	const period = $derived(CADENCE_LABEL[orbit.period.cadence]);
</script>

<div class="nested">
	<p class="muted summary">
		{formatAmount(closed, ORBIT_METRIC)} closed {period} out of
		{formatAmount(orbit.target, ORBIT_METRIC)}, from
		{children.length}
		{children.length === 1 ? 'goal' : 'goals'} feeding this one.
	</p>

	<ul>
		{#each children as child (child.goalId)}
			<li>
				<span class="dot" aria-hidden="true" style="background: {child.color}"></span>
				<a href={resolve('/goals/[id]', { id: child.goalId })}>{child.title}</a>
				<span class="muted tier">{TIER_DEFINITIONS[child.tier].label}</span>
				<span class="count">
					{#if child.current.dormant}
						archived, nothing expected
					{:else}
						{formatAmount(child.closed, ORBIT_METRIC)}
						{period}
					{/if}
				</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.nested {
		display: grid;
		gap: var(--gap-block);
	}

	.summary {
		font-size: var(--text-secondary);
	}

	ul {
		display: grid;
		gap: 0.1rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		align-items: center;
		display: grid;
		gap: 0.5rem;
		grid-template-columns: auto auto 1fr auto;
		/* These are links in a list, so they take the floor like every other
		   control — the same rule the entry rows follow. */
		min-height: var(--tap-min);
	}

	.dot {
		border-radius: 50%;
		flex: none;
		height: 0.55rem;
		width: 0.55rem;
	}

	.tier,
	.count {
		font-size: var(--text-secondary);
	}

	.count {
		color: var(--text-bright);
		text-align: right;
	}

	@media (max-width: 34rem) {
		li {
			grid-template-columns: auto 1fr auto;
		}

		.tier {
			display: none;
		}
	}
</style>
