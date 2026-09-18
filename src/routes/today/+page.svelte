<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import AsteroidBelt from '$components/AsteroidBelt.svelte';
	import GoalCard from '$components/GoalCard.svelte';
	import GoalRow from '$components/GoalRow.svelte';
	import GoalRowSheet from '$components/GoalRowSheet.svelte';
	import Mascot from '$components/Mascot.svelte';
	import { celebration, heldGoal, justClosed, noteOrbits } from '$lib/celebration.svelte';
	import { overlayAll } from '$domain/queue';
	import { queuedEntries } from '$lib/offline/queue.svelte';
	import type { FocusRow, GoalSnapshot, TodayFocus } from '$domain/progress';
	import { focusForToday, formatTimeLeft, periodElapsed } from '$domain/progress';
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
	const rawFocus = $derived(focusForToday(snapshots, data.now));

	/**
	 * Where each goal sat the last time it was not being celebrated. Plain,
	 * like `seen` in the celebration store, and written from inside the same
	 * derivation that reads it: `$state` here would retrigger the derivation
	 * it feeds, and this only ever needs the value `focus` already settled on
	 * a moment ago.
	 */
	const lastBucket: Record<string, 'atRisk' | 'steady'> = {};

	/**
	 * `focusForToday` moves a goal to Closed the instant its orbit does, which
	 * would tear the non-compact `GoalCard` mid-sweep out of the list it was
	 * animating in (#51) — the dial's arc and travelling body are a CSS
	 * transition running on that specific element, and a fresh one built in the
	 * Closed fold starts cold. So a goal mid-celebration is held in the section
	 * it already occupied until the celebration — the `SWEEP_MS` wait and the
	 * burst both — has finished.
	 *
	 * Compact's sheet no longer needs this: `GoalRowSheet` lives outside every
	 * `{#each}` a row is drawn in, so it stays put regardless of which section
	 * the row itself is in. Holding the row here anyway is harmless — compact
	 * just gets the same brief pause non-compact needs for its dial.
	 *
	 * `justClosed` catches the render `noteOrbits` would otherwise catch a beat
	 * late: that effect runs one render after the data it reacts to, and by
	 * then the row this is protecting would already have moved. `heldGoal`
	 * picks up from there and carries the hold through the wait and the burst.
	 */
	const focus = $derived.by((): TodayFocus => {
		for (const row of rawFocus.atRisk) lastBucket[row.snapshot.goal.id] = 'atRisk';
		for (const row of rawFocus.steady) lastBucket[row.snapshot.goal.id] = 'steady';

		let holdId: string | null = null;
		for (const snapshot of snapshots) {
			if (justClosed(snapshot)) holdId = snapshot.goal.id;
		}
		// Read unconditionally, `??=` would skip the call once the loop above has
		// already found one — and an unread `heldGoal()` is untracked, so this
		// derivation would never rerun once the celebration it is waiting on ends.
		const stillHeld = heldGoal();
		holdId ??= stillHeld;
		if (!holdId) return rawFocus;

		const index = rawFocus.closed.findIndex((snapshot) => snapshot.goal.id === holdId);
		if (index === -1) return rawFocus;

		const stillClosed = [...rawFocus.closed.slice(0, index), ...rawFocus.closed.slice(index + 1)];
		const row: FocusRow = {
			snapshot: rawFocus.closed[index],
			urgency: 0,
			closing: false,
			behindPace: false,
			owedToday: false
		};
		return lastBucket[holdId] === 'steady'
			? { ...rawFocus, closed: stillClosed, steady: [row, ...rawFocus.steady] }
			: { ...rawFocus, closed: stillClosed, atRisk: [row, ...rawFocus.atRisk] };
	});
	const logAction = $derived(`${resolve('/today')}?/log`);
	/**
	 * The belt's four endings and its add, as actions on this page. It is a band
	 * below the orbits rather than a destination of its own: the header already
	 * carries four links, and giving the belt a fifth is exactly what would turn
	 * it into a second product living inside the first.
	 */
	const belt = $derived({
		add: `${resolve('/today')}?/addAsteroid`,
		clear: `${resolve('/today')}?/clearAsteroid`,
		release: `${resolve('/today')}?/releaseAsteroid`,
		edit: `${resolve('/today')}?/editAsteroid`,
		dismiss: `${resolve('/today')}?/dismissCapture`
	});
	/**
	 * Density is CSS everywhere else, but compact is a different shape here, not
	 * the same one with less padding round it — so this one has to be a branch
	 * rather than a token. It is server-rendered either way, so there is nothing
	 * for hydration to disagree about.
	 */
	const compact = $derived(data.user?.preferences.density === 'compact');

	/**
	 * Which goal's sheet a compact row asked to open, if any. One id rather than
	 * a snapshot, so the sheet below always reads the goal's current state —
	 * closing, then closed — straight out of `snapshots` rather than a copy
	 * frozen at the moment the row was tapped.
	 */
	let openGoalId = $state<string | null>(null);
	const openSnapshot = $derived(
		snapshots.find((snapshot) => snapshot.goal.id === openGoalId) ?? null
	);

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
				{:else if focus.atRisk.length === 0 && focus.closed.length > 0}
					Nothing owed. {focus.closed.length}
					{focus.closed.length === 1 ? 'orbit is' : 'orbits are'} closed.
				{:else if focus.atRisk.length === 0}
					Nothing owed today.
				{:else}
					{focus.atRisk.length}
					{focus.atRisk.length === 1 ? 'orbit is' : 'orbits are'} pending — owed today, running out of
					time, or behind pace.
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
			Everything that closes today has closed, nothing is running out of time, and nothing is behind
			the pace its period asks for. Whatever is still in flight has room left.
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
							flag={row.behindPace && !row.closing ? 'Behind pace' : undefined}
							onopen={(goalId) => (openGoalId = goalId)}
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
		Both folds draw compact rows rather than a line of text, whatever density
		the pilot has chosen. A closed orbit is the reward the whole app is built
		around and a filled ring says that in a way "closed today" never will, so
		folding a goal away is allowed to cost its detail but not its dial.

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
			<ul class="flight">
				{#each focus.closed as snapshot (snapshot.goal.id)}
					<li><GoalRow {snapshot} onopen={(goalId) => (openGoalId = goalId)} /></li>
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
				Still in flight and on pace, with the deadline past tonight — the one furthest behind first.
				Nothing here is owed today.
			</p>
			<ul class="flight">
				{#each focus.steady as row (row.snapshot.goal.id)}
					<li><GoalRow snapshot={row.snapshot} onopen={(goalId) => (openGoalId = goalId)} /></li>
				{/each}
			</ul>
		</details>
	{/if}

	<!--
		Below the bands, and last: asteroids are what you reach for when nothing
		is due. The same clock the orbits were measured against decides how far
		each rock has drifted, so the page tells one time throughout.
	-->
	<AsteroidBelt
		asteroids={data.asteroids}
		done={data.doneAsteroids}
		now={data.now}
		{compact}
		errors={form?.errors ?? null}
		message={form?.belt ?? null}
		offer={form?.offer ?? null}
		addAction={belt.add}
		clearAction={belt.clear}
		releaseAction={belt.release}
		editAction={belt.edit}
		dismissAction={belt.dismiss}
	/>

	<GoalRowSheet snapshot={openSnapshot} {logAction} onclose={() => (openGoalId = null)} />
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

	.risk,
	.flight {
		display: grid;
		gap: var(--gap-list);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	/* Rows are a list, not a stack of cards, and read better close together. */
	:global(html[data-density='compact']) .risk,
	:global(html[data-density='compact']) .flight {
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

	/* A fold's rows sit in from its summary, and clear of it. */
	.fold .flight {
		margin: 0.35rem 0 0.6rem;
	}
</style>
