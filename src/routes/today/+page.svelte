<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import GoalCard from '$components/GoalCard.svelte';
	import GoalRow from '$components/GoalRow.svelte';
	import Mascot from '$components/Mascot.svelte';
	import { celebration, noteOrbits } from '$lib/celebration.svelte';
	import { overlayAll } from '$domain/queue';
	import { queuedEntries } from '$lib/offline/queue.svelte';
	import type { FocusRow, GoalSnapshot } from '$domain/progress';
	import { metricFor } from '$domain/nesting';
	import { focusForToday, formatAmount, formatTimeLeft, periodElapsed } from '$domain/progress';
	import { CADENCE_LABEL, TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * The server's snapshots with the offline queue folded in. The ranking below
	 * runs on the result, so a goal whose queued entry closed its orbit leaves
	 * the at-risk list immediately rather than waiting for a network.
	 */
	const snapshots = $derived(
		overlayAll(data.snapshots, queuedEntries(), {
			timeZone: data.user?.timeZone ?? 'UTC',
			weekStartsOn: data.user?.weekStartsOn
		})
	);
	/** Ranked on the same clock the orbits were measured against. */
	const focus = $derived(focusForToday(snapshots, data.now));
	const logAction = $derived(`${resolve('/today')}?/log`);
	/**
	 * Density is CSS everywhere else, but compact is a different shape here, not
	 * the same one with less padding round it — so this one has to be a branch
	 * rather than a token. It is server-rendered either way, so there is nothing
	 * for hydration to disagree about.
	 */
	const compact = $derived(data.user?.preferences.density === 'compact');

	/**
	 * A goal that closes leaves the at-risk list, taking its dial with it, so the
	 * closing is caught here rather than in a component that is on its way out.
	 * The mascot salutes and the live region says which goal it was.
	 */
	$effect(() => noteOrbits(snapshots));
	const closed = $derived(celebration());

	function timeLeft(snapshot: GoalSnapshot): string {
		return formatTimeLeft(snapshot.current.period, data.now);
	}

	function standing(snapshot: GoalSnapshot): string {
		const { goal, current } = snapshot;
		// Orbits rather than the goal's own metric once it has children.
		const metric = metricFor(snapshot);
		return `${formatAmount(current.logged, metric)} / ${formatAmount(goal.target, metric)}`;
	}

	function percent(fraction: number): number {
		return Math.round(fraction * 100);
	}

	/**
	 * Why this row is here. A closing period speaks for itself in time left; a
	 * goal behind pace with months to run has to say so, and the two numbers that
	 * make the case are the ones worth showing.
	 */
	function reason(row: FocusRow): string {
		const { snapshot } = row;
		const cadence = CADENCE_LABEL[snapshot.current.period.cadence];
		if (row.closing) return `${timeLeft(snapshot)} of ${cadence}`;
		const gone = periodElapsed(snapshot.current.period, data.now, snapshot.goal.createdAt);
		return `${percent(snapshot.current.fraction)}% done, ${percent(gone)}% of ${cadence} gone`;
	}
</script>

<svelte:head>
	<title>Today · Nova</title>
	<meta name="description" content="What needs attention before the period closes." />
</svelte:head>

<section class="today">
	<header class="head">
		<div>
			<h1>Today</h1>
			<p class="muted">
				{#if snapshots.length === 0}
					Nothing in orbit yet.
				{:else if focus.atRisk.length === 0}
					Nothing at risk. {focus.closed.length}
					{focus.closed.length === 1 ? 'orbit' : 'orbits'} closed.
				{:else}
					{focus.atRisk.length}
					{focus.atRisk.length === 1 ? 'orbit needs' : 'orbits need'} attention — running out of time
					or behind pace.
				{/if}
			</p>
		</div>
		<a class="button button--ghost" href={resolve('/')}>All tiers</a>
	</header>

	{#if snapshots.length > 0}
		<Mascot {focus} now={data.now} />
	{/if}

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

	<p class="live" role="status">
		{#if closed}
			{closed.title} closed its orbit <span aria-hidden="true">✦</span>
		{:else if form?.logged}
			Logged.
		{/if}
	</p>

	{#if snapshots.length === 0}
		<div class="empty panel">
			<Astronaut size={170} cheer={closed !== null} />
			<h2>Nothing in orbit yet</h2>
			<p class="muted">
				Today has nothing to ask of you until something is flying. A Satellite closes every day,
				which is the quickest way to see this screen earn its keep.
			</p>
			<a class="button" href={resolve('/goals/new')}>Launch a goal</a>
		</div>
	{:else if focus.atRisk.length === 0}
		<p class="muted clear">
			Nothing is short of target with its period closing, and nothing is behind the pace its period
			asks for. Whatever is still in flight has room left.
		</p>
	{:else}
		<ul class="risk">
			{#each focus.atRisk as row (row.snapshot.goal.id)}
				<li>
					{#if compact}
						<!-- The tier and the reason are what the row gives up to be a row.
						     The tier is in the dial it still draws, and the order of the
						     list is the urgency the reason was spelling out. -->
						<GoalRow
							snapshot={row.snapshot}
							{logAction}
							flag={row.behindPace && !row.closing ? 'Behind pace' : undefined}
						/>
					{:else}
						<p class="deadline">
							<span class="pill" style="color: {TIER_DEFINITIONS[row.snapshot.goal.tier].accent}">
								{TIER_DEFINITIONS[row.snapshot.goal.tier].label}
							</span>
							{#if row.behindPace && !row.closing}
								<span class="flag">Behind pace</span>
							{/if}
							<span class="muted">{reason(row)}</span>
						</p>
						<GoalCard snapshot={row.snapshot} {logAction} />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<!--
		Native `<details>`/`<summary>` rather than a button plus `aria-expanded`:
		the element already maps to a disclosure whose state is announced and
		which opens from the keyboard, and every ARIA role worth putting on a
		`<summary>` replaces that mapping with a worse one. The one thing it does
		get wrong is the star, which a screen reader reads out as "black
		four-pointed star" in the middle of a count — so that is hidden, here and
		everywhere else it is used as punctuation.
	-->
	{#if focus.closed.length > 0}
		<details class="fold" open>
			<summary>
				Closed ({focus.closed.length}) <span aria-hidden="true">✦</span>
			</summary>
			<ul class="compact">
				{#each focus.closed as snapshot (snapshot.goal.id)}
					<li>
						<a class="tap" href={resolve('/goals/[id]', { id: snapshot.goal.id })}
							>{snapshot.goal.title}</a
						>
						<span class="muted">{standing(snapshot)}</span>
						<span class="done">closed {CADENCE_LABEL[snapshot.current.period.cadence]}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if focus.steady.length > 0}
		<details class="fold">
			<summary>
				Flying steady ({focus.steady.length})
			</summary>
			<p class="muted fold__note">
				Still in flight and on pace, the one furthest behind first. Nothing here is owed today.
			</p>
			<ul class="compact">
				{#each focus.steady as row (row.snapshot.goal.id)}
					<li>
						<a class="tap" href={resolve('/goals/[id]', { id: row.snapshot.goal.id })}
							>{row.snapshot.goal.title}</a
						>
						<span class="muted">{standing(row.snapshot)}</span>
						<span class="muted">{timeLeft(row.snapshot)}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</section>

<style>
	.today {
		display: grid;
		gap: var(--gap-view);
	}

	.head {
		align-items: end;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: var(--text-secondary);
		margin: -0.9rem 0 0;
	}

	.empty {
		display: grid;
		gap: var(--gap-block);
		justify-items: center;
		padding: 2rem 1.25rem;
		text-align: center;
	}

	/* The pilot above says it is a clear sky; this says what that means. */
	.clear {
		font-size: var(--text-secondary);
		margin: -0.5rem 0 0;
		max-width: 60ch;
	}

	.risk {
		display: grid;
		gap: var(--gap-list);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* Rows are a list, not a stack of cards, and read better close together. */
	:global(html[data-density='compact']) .risk {
		gap: 0.35rem;
	}

	.deadline {
		align-items: baseline;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.6rem;
		margin: 0 0 0.3rem;
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

	.flag {
		border: 1px solid currentColor;
		border-radius: 999px;
		color: var(--accent-warm);
		font-size: var(--text-label);
		font-weight: 640;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.deadline .muted {
		font-size: var(--text-secondary);
	}

	.fold {
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		padding: 0.35rem 0.9rem;
	}

	/*
	 * A disclosure is a control, so it carries the floor like any other — by
	 * padding rather than by `.tap`, because any `display` other than
	 * `list-item` takes the triangle away with it. The fold's own padding comes
	 * down to pay for the taller summary.
	 */
	summary {
		color: var(--text-bright);
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap-min);
		padding: 0.68rem 0;
	}

	.fold__note {
		font-size: var(--text-secondary);
		margin: 0.4rem 0 0;
		max-width: 60ch;
	}

	.compact {
		display: grid;
		gap: 0.15rem;
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
	}

	.compact li {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.6rem;
		justify-content: space-between;
	}

	.compact a {
		color: var(--text-bright);
	}

	.compact span {
		font-size: var(--text-secondary);
	}

	.done {
		color: var(--success);
		font-size: var(--text-secondary);
	}
</style>
