<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import {
		averageMomentum,
		completionByTier,
		goalStreaks,
		loggingRhythm,
		momentumFor,
		overallCompletion,
		topMomentum
	} from '$domain/stats';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/**
	 * Every number on this page reads through these two: the user's own zone,
	 * so weekday and pace line up with their calendar rather than the server's,
	 * and `data.now`, so "decided" and "in flight" never disagree with each
	 * other from one stat to the next.
	 */
	const options = $derived({
		timeZone: data.user?.timeZone ?? 'UTC',
		weekStartsOn: data.user?.weekStartsOn
	});

	const tiers = $derived(
		completionByTier(
			data.snapshots.map((snapshot) => ({ tier: snapshot.goal.tier, history: snapshot.history })),
			data.now
		)
	);
	const overall = $derived(overallCompletion(tiers));

	const streaks = $derived(
		goalStreaks(
			data.snapshots.map((snapshot) => ({
				goalId: snapshot.goal.id,
				title: snapshot.goal.title,
				tier: snapshot.goal.tier,
				history: snapshot.history
			}))
		)
	);
	const topStreak = $derived(streaks.find((streak) => streak.best > 0) ?? null);

	/**
	 * Momentum and the logging rhythm both want a goal's own timestamped
	 * entries, which only a leaf goal has — a derived goal is refused a log at
	 * write time, so `data.leaves` is where every entry in the account lives.
	 */
	const momenta = $derived(
		data.leaves.map((leaf) =>
			momentumFor(
				{
					goalId: leaf.goal.id,
					title: leaf.goal.title,
					tier: leaf.goal.tier,
					cadence: TIER_DEFINITIONS[leaf.goal.tier].cadence,
					createdAt: leaf.goal.createdAt,
					entries: leaf.entries,
					dormantWindows: leaf.dormantWindows
				},
				options,
				data.now
			)
		)
	);
	const avgMomentum = $derived(averageMomentum(momenta));
	const movers = $derived(topMomentum(momenta));

	const rhythm = $derived(
		loggingRhythm(
			data.leaves.flatMap((leaf) => leaf.entries),
			options
		)
	);
	const rhythmMax = $derived(Math.max(1, ...rhythm.byWeekday));

	const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	function percent(fraction: number): number {
		return Math.round(fraction * 100);
	}

	function ratioLabel(ratio: number): string {
		return `${ratio.toFixed(2)}× usual pace`;
	}
</script>

<svelte:head>
	<title>Stats · Nova</title>
	<meta
		name="description"
		content="Patterns across your goals: streaks, completion, pace and when you log."
	/>
</svelte:head>

<section class="stats">
	<header class="head">
		<h1>Stats</h1>
		<p class="muted">
			Four numbers worked out from your active goals — nothing archived, and nothing dormant counted
			against you.
		</p>
	</header>

	{#if data.snapshots.length === 0}
		<div class="empty panel">
			<Astronaut size={170} />
			<h2>Nothing to measure yet</h2>
			<p class="muted">
				Stats need orbits to look back on. Launch a goal and come back once a few periods have
				closed.
			</p>
			<a class="button" href={resolve('/goals/new')}>Launch a goal</a>
		</div>
	{:else}
		<section class="tile panel">
			<h2>Best streak</h2>
			<p class="muted">
				The longest run of closed orbits a goal has ever had, not just the one still standing —
				proof you can hold a pace, even if this week broke it.
			</p>
			{#if topStreak}
				<p class="headline">
					{topStreak.best}
					{topStreak.best === 1 ? 'orbit' : 'orbits'} in a row
					<span class="muted">— {topStreak.title}</span>
				</p>
				<ul class="rows">
					{#each streaks.slice(0, 5) as streak (streak.goalId)}
						<li>
							<span class="pill" style="color: {TIER_DEFINITIONS[streak.tier].accent}">
								{TIER_DEFINITIONS[streak.tier].label}
							</span>
							<span class="row-title">{streak.title}</span>
							<span class="muted">
								{streak.current} now
								{#if streak.current < streak.best}
									<span class="dim">/ {streak.best} best</span>
								{:else}
									<span class="best">— a new best</span>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Nothing has closed an orbit yet.</p>
			{/if}
		</section>

		<section class="tile panel">
			<h2>Completion by tier</h2>
			<p class="muted">
				Of the periods each tier has actually had a chance to close — dormant spells left out — how
				many did. If Galaxies trail Satellites here, the season-long goals are the ones being let
				slide.
			</p>
			{#if tiers.length === 0}
				<p class="muted">No tier has a decided period yet — check back once one has closed.</p>
			{:else}
				{#if overall.rate !== null}
					<p class="headline">
						{percent(overall.rate)}%<span class="muted">
							overall, {overall.closed} of {overall.decided}</span
						>
					</p>
				{/if}
				<ul class="bars">
					{#each tiers as tier (tier.tier)}
						<li>
							<div class="bar-label">
								<span>{TIER_DEFINITIONS[tier.tier].label}</span>
								<span class="muted">{tier.closed}/{tier.decided}</span>
							</div>
							<div class="bar-track">
								<div
									class="bar-fill"
									style="width: {percent(tier.rate)}%; background: {TIER_DEFINITIONS[tier.tier]
										.accent}"
								></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="tile panel">
			<h2>Momentum</h2>
			<p class="muted">
				This period so far, against your own pace at the same point in past periods — not an assumed
				straight line to the target. Below 1&times; means slower than you usually are by now, not
				necessarily behind.
			</p>
			{#if avgMomentum === null}
				<p class="muted">
					No goal has a full past period to compare against yet — momentum needs at least one.
				</p>
			{:else}
				<p class="headline">{ratioLabel(avgMomentum)}<span class="muted"> on average</span></p>
				<div class="movers">
					{#if movers.gaining.length > 0}
						<div>
							<h3>Gaining</h3>
							<ul class="rows">
								{#each movers.gaining as momentum (momentum.goalId)}
									<li>
										<span class="row-title">{momentum.title}</span>
										<span class="muted">{ratioLabel(momentum.ratio ?? 1)}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if movers.slipping.length > 0}
						<div>
							<h3>Slipping</h3>
							<ul class="rows">
								{#each movers.slipping as momentum (momentum.goalId)}
									<li>
										<span class="row-title">{momentum.title}</span>
										<span class="muted">{ratioLabel(momentum.ratio ?? 1)}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<section class="tile panel">
			<h2>When you log</h2>
			<p class="muted">
				Which day actually gets your attention, in your own time zone — often not the one a reminder
				is set for.
			</p>
			{#if rhythm.peakWeekday === null}
				<p class="muted">Nothing logged yet.</p>
			{:else}
				<p class="headline">
					Mostly {rhythm.peakWeekday}s<span class="muted"
						>, in the {rhythm.peakPart?.toLowerCase()}</span
					>
				</p>
				<!-- Decorative: the count beside each bar carries the same numbers. -->
				<div class="chart" role="img" aria-label="Entries logged by day of the week">
					{#each rhythm.byWeekday as count, day (day)}
						<div class="chart-bar">
							<div class="chart-fill" style="height: {(count / rhythmMax) * 100}%"></div>
							<span class="chart-count">{count}</span>
							<span class="chart-label">{WEEKDAY_SHORT[day]}</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</section>

<style>
	.stats {
		display: grid;
		gap: var(--gap-view);
	}

	.head h1 {
		margin: 0 0 0.3rem;
	}

	.empty {
		display: grid;
		gap: var(--gap-block);
		justify-items: center;
		padding: 2rem 1.25rem;
		text-align: center;
	}

	.tile {
		display: grid;
		gap: 0.6rem;
		padding: var(--pad-panel);
	}

	.tile h2 {
		margin: 0;
	}

	.tile h3 {
		font-size: var(--text-secondary);
		margin: 0 0 0.3rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}

	.headline {
		color: var(--text-bright);
		font-size: 1.4rem;
		font-weight: 650;
		margin: 0;
	}

	.headline .muted {
		font-size: 0.95rem;
		font-weight: 500;
	}

	.rows {
		display: grid;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.rows li {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.6rem;
	}

	.row-title {
		color: var(--text-bright);
		flex: 1 1 auto;
	}

	.pill {
		border: 1px solid currentColor;
		border-radius: 999px;
		font-size: var(--text-label);
		font-weight: 640;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.dim {
		color: var(--text-dim);
	}

	.best {
		color: var(--success);
	}

	.bars {
		display: grid;
		gap: 0.55rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.bar-label {
		display: flex;
		font-size: var(--text-secondary);
		justify-content: space-between;
		margin-bottom: 0.2rem;
	}

	.bar-track {
		background: var(--space-mid);
		border-radius: 999px;
		height: 0.6rem;
		overflow: hidden;
	}

	.bar-fill {
		border-radius: 999px;
		height: 100%;
	}

	.movers {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
	}

	.chart {
		align-items: flex-end;
		display: grid;
		gap: 0.4rem;
		grid-template-columns: repeat(7, 1fr);
		height: 6rem;
	}

	.chart-bar {
		align-items: center;
		display: flex;
		flex-direction: column;
		height: 100%;
		justify-content: flex-end;
	}

	.chart-fill {
		background: var(--accent);
		border-radius: 0.25rem 0.25rem 0 0;
		min-height: 2px;
		width: 100%;
	}

	.chart-count {
		color: var(--text-dim);
		font-size: var(--text-label);
		margin-top: 0.2rem;
	}

	.chart-label {
		color: var(--text-dim);
		font-size: var(--text-label);
	}

	@media (prefers-reduced-motion: reduce) {
		.chart-fill {
			transition: none;
		}
	}
</style>
