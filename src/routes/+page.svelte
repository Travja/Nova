<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import GoalCard from '$components/GoalCard.svelte';
	import GoalRow from '$components/GoalRow.svelte';
	import GoalRowSheet from '$components/GoalRowSheet.svelte';
	import GoalOrderList from '$components/GoalOrderList.svelte';
	import Rocket from '$components/Rocket.svelte';
	import Universe from '$components/Universe.svelte';
	import { noteOrbits } from '$lib/celebration.svelte';
	import { overlayAll } from '$domain/queue';
	import { queuedEntries } from '$lib/offline/queue.svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import { TIER_LIST } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * The server's snapshots with the offline queue folded in, so a goal logged
	 * without a network moves its dial here exactly as it will once the entry
	 * lands. Same maths either way — `$domain/queue` runs `buildOrbit` and
	 * `streakFrom` over the entries the browser is still carrying.
	 */
	const snapshots = $derived(
		overlayAll(data.snapshots ?? [], queuedEntries(), {
			timeZone: data.user?.timeZone ?? 'UTC',
			weekStartsOn: data.user?.weekStartsOn
		})
	);
	/** See the note in `/today`: compact is a different shape, not a token. */
	const compact = $derived(data.user?.preferences.density === 'compact');

	/** See the note in `/today`: one sheet outside the grid, opened by goal id. */
	let openGoalId = $state<string | null>(null);
	const openSnapshot = $derived(
		snapshots.find((snapshot) => snapshot.goal.id === openGoalId) ?? null
	);

	/** Tiers in orbital order, keeping only the ones that have goals. */
	const sections = $derived(
		TIER_LIST.map((tier) => ({
			tier,
			goals: snapshots.filter((snapshot: GoalSnapshot) => snapshot.goal.tier === tier.id)
		})).filter((section) => section.goals.length > 0)
	);

	/**
	 * The universe view's list (#11): the same tree the universe draws,
	 * in words. A goal is a root when it has no parent, or when its parent is
	 * not among these snapshots — an archived parent, most often — so it orbits
	 * an anchor rather than nothing, exactly as `$domain/universe` decides.
	 */
	function isRoot(snapshot: GoalSnapshot): boolean {
		const parentId = snapshot.goal.parentId;
		return !parentId || !snapshots.some((candidate) => candidate.goal.id === parentId);
	}

	function childrenOf(goalId: string): GoalSnapshot[] {
		return snapshots.filter((snapshot: GoalSnapshot) => snapshot.goal.parentId === goalId);
	}

	/** Roots grouped by tier, same as `sections` above — only roots count for the grouping. */
	const universeSections = $derived(
		TIER_LIST.map((tier) => ({
			tier,
			roots: snapshots.filter(
				(snapshot: GoalSnapshot) => snapshot.goal.tier === tier.id && isRoot(snapshot)
			)
		})).filter((section) => section.roots.length > 0)
	);

	/** Logging happens on the cards here, so this is where a closing is spotted. */
	$effect(() => noteOrbits(snapshots));

	const closedThisPeriod = $derived(
		snapshots.filter((snapshot: GoalSnapshot) => snapshot.current.complete).length
	);

	/**
	 * On a phone the tiered grid is the wrong first screen, so a fresh landing on
	 * `/` goes to the focused view instead — the nav and the button above keep the
	 * dashboard one tap away.
	 *
	 * Only a fresh landing: arriving here by link is a deliberate choice, and the
	 * session flag makes that choice survive a reload. Both the media query and
	 * the redirect need a browser, so the dashboard is what renders on the server
	 * and what anyone without JavaScript keeps.
	 */
	const NARROW = '(max-width: 40rem)';
	const CHOSE_TIERS = 'nova:tiered-dashboard';

	function rememberTiers() {
		try {
			sessionStorage.setItem(CHOSE_TIERS, '1');
		} catch {
			// Private modes can refuse storage; the redirect simply stays on.
		}
	}

	function choseTiers(): boolean {
		try {
			return sessionStorage.getItem(CHOSE_TIERS) === '1';
		} catch {
			return false;
		}
	}

	afterNavigate(({ type }) => {
		if (!data.user) return;
		if (type !== 'enter') {
			rememberTiers();
			return;
		}
		if (choseTiers() || !window.matchMedia(NARROW).matches) return;
		goto(resolve('/today'), { replaceState: true });
	});

	/**
	 * Set by `GoalOrderList` for every move it makes, dragged or keyed — it says
	 * where the goal landed, which the server's own reply cannot. The fallback is
	 * for a move made with no JavaScript at all, where the page has navigated and
	 * there is nothing client-side left to have said anything.
	 */
	let moveAnnouncement = $state('');
	const announcement = $derived(
		moveAnnouncement || (form?.moved ? `${form.moved} moved within its tier.` : '')
	);
</script>

<svelte:head>
	<title>Nova</title>
	<meta
		name="description"
		content="Nova turns your goals into orbits — from daily satellites to yearly universes."
	/>
</svelte:head>

{#if !data.user}
	<section class="hero">
		<div class="hero__copy">
			<h1>Your goals, in orbit.</h1>
			<p class="lede">
				Nova measures progress the way space does — in revolutions. Log a little, watch the body
				travel, and close the orbit before the period ends.
			</p>
			<div class="hero__actions">
				<a class="button" href={resolve('/register')}>Start flying</a>
				<a class="button button--ghost" href={resolve('/login')}>Sign in</a>
			</div>
			<ul class="tier-list">
				{#each TIER_LIST as tier (tier.id)}
					<li>
						<span class="dot" style="background: {tier.accent}"></span>
						<strong>{tier.label}</strong>
						<span class="muted">{tier.blurb}</span>
					</li>
				{/each}
			</ul>
		</div>
		<div class="hero__art">
			<Rocket size={110} launching />
			<Astronaut size={190} />
		</div>
	</section>
{:else if snapshots.length === 0}
	<section class="empty panel">
		<Astronaut size={190} />
		<h1>Nothing in orbit yet</h1>
		<p class="lede">
			Add your first goal and Nova will start tracking its revolutions. Something small is a good
			start — a Satellite closes every day.
		</p>
		<a class="button" href={resolve('/goals/new')}>Launch a goal</a>
	</section>
{:else}
	<section class="dashboard">
		<div class="dashboard__head">
			<div>
				<h1>Good to see you, {data.user.displayName}.</h1>
				<p class="muted">
					{closedThisPeriod} of {snapshots.length}
					{snapshots.length === 1 ? 'orbit' : 'orbits'} closed in their current period.
				</p>
			</div>
			<div class="dashboard__actions">
				{#if data.reordering}
					<a class="button button--ghost" href={resolve('/')}>Done reordering</a>
				{:else}
					<form
						method="POST"
						action="?/view"
						use:enhance
						class="view-toggle"
						aria-label="Dashboard view"
					>
						<button
							type="submit"
							name="view"
							value="tiers"
							class="button button--ghost"
							aria-pressed={data.user.preferences.dashboard !== 'universe'}
						>
							Tiers
						</button>
						<button
							type="submit"
							name="view"
							value="universe"
							class="button button--ghost"
							aria-pressed={data.user.preferences.dashboard === 'universe'}
						>
							Universe
						</button>
					</form>
					<a class="button button--ghost" href="{resolve('/')}?reorder=1">Reorder</a>
					<a class="button" href={resolve('/goals/new')}>New goal</a>
				{/if}
			</div>
		</div>

		{#if form?.errors?.form}
			<p class="error">{form.errors.form}</p>
		{/if}

		{#if data.reordering}
			<p class="muted reorder-hint">
				Drag a goal, or use the arrows — they work from a keyboard and announce where the goal
				landed. Order applies wherever the tier is listed.
			</p>
			<p class="live" role="status">{announcement}</p>
		{/if}

		{#if !data.reordering && data.user.preferences.dashboard === 'universe'}
			<Universe
				{snapshots}
				asteroids={data.asteroids}
				now={data.now}
				covered={openGoalId !== null}
				onopen={(goalId) => (openGoalId = goalId)}
			>
				{#each universeSections as section (section.tier.id)}
					<section class="tier">
						<header class="tier__head">
							<h2 style="color: {section.tier.accent}">{section.tier.label}</h2>
							<span class="muted">{section.tier.blurb}</span>
						</header>
						<ul class="universe__tree">
							{#each section.roots as root (root.goal.id)}
								{@render goalBranch(root)}
							{/each}
						</ul>
					</section>
				{/each}
			</Universe>
		{:else}
			{#each sections as section (section.tier.id)}
				<section class="tier">
					<header class="tier__head">
						<h2 style="color: {section.tier.accent}">{section.tier.label}</h2>
						<span class="muted">{section.tier.blurb}</span>
					</header>
					{#if data.reordering}
						<GoalOrderList
							tier={section.tier}
							goals={section.goals}
							onannounce={(message) => (moveAnnouncement = message)}
						/>
					{:else}
						<div class="grid" class:grid--rows={compact}>
							{#each section.goals as snapshot (snapshot.goal.id)}
								{#if compact}
									<GoalRow {snapshot} onopen={(goalId) => (openGoalId = goalId)} />
								{:else}
									<GoalCard {snapshot} />
								{/if}
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		{/if}

		<!-- The universe list, recursive: a goal's children nest under it in a
		     `<ul>` at every depth, the same tree `$domain/universe` draws. Each row
		     is the ordinary `GoalRow`, opening the one sheet the page already
		     holds; `data-goal-id` is how keyboard focus on a row flies the camera
		     there. -->
		{#snippet goalBranch(snapshot: GoalSnapshot)}
			{@const children = childrenOf(snapshot.goal.id)}
			<li data-goal-id={snapshot.goal.id}>
				<GoalRow {snapshot} onopen={(goalId) => (openGoalId = goalId)} />
				{#if children.length > 0}
					<ul>
						{#each children as child (child.goal.id)}
							{@render goalBranch(child)}
						{/each}
					</ul>
				{/if}
			</li>
		{/snippet}

		<p class="archive-link muted">
			<a href={resolve('/stats')}>Stats</a> pull streaks, completion and pace out of everything
			above.
			<a href={resolve('/goals/archived')}>Archived goals</a> keep their history without asking for an
			orbit.
		</p>

		<GoalRowSheet snapshot={openSnapshot} onclose={() => (openGoalId = null)} />
	</section>
{/if}

<style>
	.lede {
		color: var(--text);
		font-size: 1.05rem;
		max-width: 42ch;
	}

	.hero {
		align-items: center;
		display: grid;
		gap: 2rem;
		grid-template-columns: 1.2fr 0.8fr;
		padding: 2rem 0 3rem;
	}

	.hero__copy {
		display: grid;
		gap: 1.25rem;
	}

	.hero__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.hero__art {
		display: grid;
		justify-items: center;
		gap: 1rem;
	}

	.tier-list {
		display: grid;
		gap: 0.55rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tier-list li {
		align-items: baseline;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.92rem;
	}

	.dot {
		border-radius: 50%;
		display: inline-block;
		height: 0.55rem;
		width: 0.55rem;
	}

	.empty {
		display: grid;
		gap: var(--gap-block);
		justify-items: center;
		padding: 2.5rem 1.25rem;
		text-align: center;
	}

	.dashboard {
		display: grid;
		gap: 1.5rem;
	}

	.dashboard__head {
		align-items: end;
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
	}

	.dashboard__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.reorder-hint {
		font-size: var(--text-secondary);
		margin: -0.9rem 0 0;
		max-width: 60ch;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: var(--text-secondary);
		margin: -1rem 0 0;
	}

	.archive-link {
		font-size: var(--text-secondary);
	}

	.tier {
		display: grid;
		gap: var(--gap-list);
	}

	.tier__head {
		align-items: baseline;
		border-bottom: 1px solid var(--space-border);
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		padding-bottom: 0.35rem;
	}

	.tier__head span {
		font-size: var(--text-secondary);
	}

	.grid {
		display: grid;
		gap: var(--gap-list);
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 26rem), 1fr));
	}

	/* Rows want the full width and each other's company, not a card grid. */
	.grid--rows {
		gap: 0.35rem;
		grid-template-columns: 1fr;
	}

	@media (max-width: 52rem) {
		.hero {
			grid-template-columns: 1fr;
			text-align: center;
		}

		.hero__copy {
			justify-items: center;
		}

		.tier-list li {
			justify-content: center;
		}
	}

	.view-toggle {
		border: 1px solid var(--space-border);
		border-radius: 999px;
		display: inline-flex;
		gap: 0.15rem;
		padding: 0.2rem;
	}

	.view-toggle button {
		border-radius: 999px;
	}

	.view-toggle button[aria-pressed='true'] {
		background: var(--space-surface);
		color: var(--text-bright);
	}

	.universe__tree,
	.universe__tree ul {
		display: grid;
		gap: 0.35rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.universe__tree ul {
		margin-top: 0.35rem;
		padding-left: 1.1rem;
	}
</style>
