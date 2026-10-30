<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import TierBody from '$components/TierBody.svelte';
	import { bodyVariant } from '$domain/bodies';
	import { periodLabel, zonedParts } from '$domain/period';
	import type { SkyDay } from '$domain/review';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const review = $derived(data.review);
	const timeZone = $derived(data.user?.timeZone ?? 'UTC');

	/** The year still running reads as "so far" rather than as a year flown. */
	const running = $derived(zonedParts(data.now, timeZone).year === review.year);

	const newest = $derived(data.years[0] ?? review.year);
	const oldest = $derived(data.years.at(-1) ?? review.year);

	function plural(count: number, one: string, many = `${one}s`): string {
		return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
	}

	function percent(closed: number, possible: number): number {
		return possible > 0 ? Math.round((closed / possible) * 100) : 0;
	}

	/** `8 March` — a fixed locale, so the server and the browser agree. */
	function dayLabel(instant: Date): string {
		return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'long' }).format(
			instant
		);
	}

	function capitalise(text: string): string {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	/*
	 * The sky. A fixed cell in user units inside a viewBox that scales evenly —
	 * never `preserveAspectRatio="none"`, which would turn every star into an
	 * ellipse — so a phone gets a smaller sky rather than a squashed one.
	 */
	const CELL = 12;
	const TOP = 16;
	/** Where a phone splits the sky: the week holding 1 July. */
	const half = $derived(review.sky.days.find((day) => day.key.endsWith('-07-01'))?.week ?? 26);
	const skyHeight = TOP + 7 * CELL;

	/** 0 for an unlit day, then three steps up to the brightest day of the year. */
	function level(day: SkyDay): number {
		if (day.closed === 0 || review.sky.brightest === 0) return 0;
		return Math.max(1, Math.ceil((day.closed / review.sky.brightest) * 3));
	}

	const STAR_RADIUS = [1.3, 2.6, 3.6, 4.6];

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	/** Where each month's label sits: the column holding its first day. */
	const monthLabels = $derived(
		review.sky.days
			.filter((day) => day.key.endsWith('-01'))
			.map((day) => ({ label: MONTHS[Number(day.key.slice(9, 11)) - 1], week: day.week }))
	);

	const litDays = $derived(review.sky.days.filter((day) => day.closed > 0).length);
	const flownDays = $derived(review.sky.days.filter((day) => !day.future).length);

	/** Each goal's row ring: the arc is closed of possible, and the body sits at its end. */
	const RING = 22;
	const RING_RADIUS = 16;
	const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

	const UNIVERSE_STATUS = {
		closed: 'Closed',
		open: 'Not closed',
		flying: 'Still in flight',
		resting: 'Resting all year'
	} as const;

	/** Last year beside this one, row by row — the numbers, and nothing made of them. */
	const comparison = $derived(
		review.lastYear
			? [
					{
						label: 'Orbits closed',
						then: review.lastYear.closed,
						now: review.headline.closed
					},
					{
						label: 'Orbits possible',
						then: review.lastYear.possible,
						now: review.headline.possible
					},
					{
						label: 'Longest flight',
						then: review.lastYear.longestFlight,
						now: review.longest?.flight.length ?? 0
					},
					{ label: 'Notes written', then: review.lastYear.notes, now: review.notes.length },
					{
						label: 'Asteroids cleared',
						then: review.lastYear.asteroidsCleared,
						now: review.asteroidsCleared
					}
				]
			: []
	);
</script>

<svelte:head>
	<title>{review.year} in review · Nova</title>
	<meta name="description" content="Your year in orbit: every orbit closed, in one place." />
</svelte:head>

<article class="year-review">
	<header class="head">
		<p class="eyebrow">Year in review</p>
		<h1>{review.year} in orbit</h1>
		{#if data.years.length > 1}
			<nav class="years" aria-label="Other years">
				{#if review.year < newest}
					<a href={resolve('/review/[year]', { year: String(review.year + 1) })}>
						{review.year + 1} →
					</a>
				{/if}
				{#if review.year > oldest}
					<a href={resolve('/review/[year]', { year: String(review.year - 1) })}>
						← {review.year - 1}
					</a>
				{/if}
			</nav>
		{/if}
	</header>

	{#if !review.hasData}
		<section class="empty panel">
			<Astronaut size={170} />
			<h2>Nothing flew in {review.year}</h2>
			<p class="muted">
				Nova has no orbits, notes or asteroids from {review.year}, so there is nothing to look back
				on here — and nothing missed, either. Every year starts empty.
			</p>
			<p class="actions">
				{#if data.years.length > 0}
					<a class="button" href={resolve('/review/[year]', { year: String(newest) })}>
						See {newest}
					</a>
				{/if}
				<a class="button button--ghost" href={resolve('/stats')}>Back to stats</a>
			</p>
		</section>
	{:else}
		<section class="headline panel" aria-labelledby="headline-title">
			<h2 id="headline-title" class="visually-hidden">Orbits closed</h2>
			<p class="big">
				{plural(review.headline.closed, 'orbit')} closed of {review.headline.possible.toLocaleString(
					'en-GB'
				)}.
			</p>
			<p class="muted">
				{#if running}
					{review.year} so far — the year is still in flight, so only periods that have ended or already
					closed count.
				{:else}
					Every period you had a chance at, across every tier.
				{/if}
				Time spent archived, and rest days you didn't fly, don't count against you.
			</p>
			{#if review.headline.byTier.length > 0}
				<ul class="bars">
					{#each review.headline.byTier as tier (tier.tier)}
						<li>
							<div class="bar-label">
								<span>{TIER_DEFINITIONS[tier.tier].label}</span>
								<span class="muted">{tier.closed} of {tier.possible}</span>
							</div>
							<div class="bar-track" aria-hidden="true">
								<div
									class="bar-fill"
									style="width: {percent(
										tier.closed,
										tier.possible
									)}%; background: {TIER_DEFINITIONS[tier.tier].accent}"
								></div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<div class="pair">
			<section class="tile panel" aria-labelledby="flight-title">
				<h2 id="flight-title">Longest flight</h2>
				{#if review.longest}
					<p class="stat">{plural(review.longest.flight.length, 'orbit')} in a row</p>
					<p>
						<span class="bright">{review.longest.title}</span>
						<span class="muted">
							· {TIER_DEFINITIONS[review.longest.tier].label}, {dayLabel(
								review.longest.flight.from
							)}
							to {dayLabel(review.longest.flight.until)}
						</span>
					</p>
				{:else}
					<p class="muted">No orbit closed this year — the next one starts the count.</p>
				{/if}
			</section>

			<section class="tile panel" aria-labelledby="belt-title">
				<h2 id="belt-title">The belt</h2>
				<p class="stat">{plural(review.asteroidsCleared, 'asteroid')} cleared</p>
				<p class="muted">One-offs you dealt with and never had to think about again.</p>
			</section>
		</div>

		<section class="tile panel sky-panel" aria-labelledby="sky-title">
			<h2 id="sky-title">The year as a sky</h2>
			<p class="muted">
				One star a day. A day lights up for every orbit that ended on it closed — a Satellite on its
				own day, a Planet on the last day of its week.
			</p>
			<!-- One picture, drawn whole on a wide screen and as two half-years on a
			     phone, where 53 columns across 360px would be specks. The wrapper is
			     the image; the summary under it says it in words. -->
			<div class="sky" role="img" aria-labelledby="sky-summary">
				{@render skyChart(0, review.sky.weeks, 'sky-whole')}
				{@render skyChart(0, half, 'sky-half')}
				{@render skyChart(half, review.sky.weeks, 'sky-half')}
			</div>
			<p id="sky-summary" class="muted sky-summary">
				{plural(litDays, 'day')} lit of {plural(flownDays, 'day')}{running ? ' so far' : ''}.
			</p>
		</section>

		{#if review.goals.length > 0}
			<section class="tile panel" aria-labelledby="goals-title">
				<h2 id="goals-title">Goal by goal</h2>
				<ul class="goals">
					{#each review.goals as goal (goal.goalId)}
						<li style="--color: {goal.color}">
							<svg class="ring" viewBox="0 0 44 44" aria-hidden="true">
								<circle class="ring-track" cx={RING} cy={RING} r={RING_RADIUS} />
								<circle
									class="ring-fill"
									cx={RING}
									cy={RING}
									r={RING_RADIUS}
									stroke-dasharray={RING_CIRCUMFERENCE}
									stroke-dashoffset={RING_CIRCUMFERENCE * (1 - goal.standing)}
								/>
								<g
									style="transform: rotate({goal.standing *
										360}deg); transform-origin: {RING}px {RING}px"
								>
									<TierBody
										tier={goal.tier}
										variant={bodyVariant(goal.tier, goal.goalId)}
										cx={RING}
										cy={RING - RING_RADIUS}
										r={5.5}
										compact
									/>
								</g>
							</svg>
							<div class="goal-copy">
								<span class="bright">{goal.title}</span>
								<span class="muted">
									{[
										TIER_DEFINITIONS[goal.tier].label,
										`${goal.closed} of ${goal.possible} closed`,
										goal.bestFlight > 1 ? `best flight ${goal.bestFlight}` : null,
										goal.landed ? `landed ${dayLabel(goal.landed)}` : null
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if review.universe.length > 0}
			<section class="tile panel" aria-labelledby="universe-title">
				<h2 id="universe-title">Universe goals</h2>
				<ul class="lines">
					{#each review.universe as result (result.goalId)}
						<li>
							<span class="bright">{result.title}</span>
							<span class="result result--{result.status}">
								{UNIVERSE_STATUS[
									result.status
								]}{#if result.status === 'open' || result.status === 'flying'}
									<span class="muted"> — {Math.round(result.fraction * 100)}% of the way</span>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="tile panel" aria-labelledby="notes-title">
			<h2 id="notes-title">Notes from the year</h2>
			{#if review.notes.length === 0}
				<p class="muted">
					No orbit notes this year. A line on a goal's history page, written as a period closes, is
					what this space keeps.
				</p>
			{:else}
				<ol class="notes">
					{#each review.notes as note (`${note.goalId}:${note.period.key}`)}
						<li>
							<blockquote>{note.body}</blockquote>
							<p class="muted">
								{note.goalTitle} · {capitalise(periodLabel(note.period, timeZone))}
							</p>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		{#if review.lastYear}
			<section class="tile panel" aria-labelledby="compare-title">
				<h2 id="compare-title">Against {review.lastYear.year}</h2>
				<table class="compare">
					<thead>
						<tr>
							<td></td>
							<th scope="col">{review.lastYear.year}</th>
							<th scope="col">{review.year}{running ? ' so far' : ''}</th>
						</tr>
					</thead>
					<tbody>
						{#each comparison as row (row.label)}
							<tr>
								<th scope="row">{row.label}</th>
								<td>{row.then.toLocaleString('en-GB')}</td>
								<td>{row.now.toLocaleString('en-GB')}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}

		<p class="footnote muted">
			This page is yours alone: it is not shared, and there is no link to it but your own.
		</p>
	{/if}
</article>

{#snippet skyChart(fromWeek: number, toWeek: number, variant: string)}
	<svg
		class="sky-chart {variant}"
		viewBox="0 0 {(toWeek - fromWeek) * CELL} {skyHeight}"
		aria-hidden="true"
	>
		{#each monthLabels.filter((month) => month.week >= fromWeek && month.week < toWeek) as month (month.label)}
			<text class="month" x={(month.week - fromWeek) * CELL + 1} y={10}>{month.label}</text>
		{/each}
		{#each review.sky.days.filter((day) => day.week >= fromWeek && day.week < toWeek) as day (day.key)}
			{@const lit = level(day)}
			<circle
				class="star level-{lit}"
				class:future={day.future}
				cx={(day.week - fromWeek) * CELL + CELL / 2}
				cy={TOP + day.weekday * CELL + CELL / 2}
				r={STAR_RADIUS[lit]}
			/>
		{/each}
	</svg>
{/snippet}

<style>
	.year-review {
		display: grid;
		gap: var(--gap-view);
	}

	.head {
		align-items: baseline;
		display: grid;
		gap: 0.2rem 1rem;
		grid-template-columns: 1fr auto;
	}

	.head h1 {
		grid-column: 1;
		margin: 0;
	}

	.eyebrow {
		color: var(--accent-warm);
		font-size: var(--text-secondary);
		font-weight: 640;
		grid-column: 1 / -1;
		letter-spacing: 0.1em;
		margin: 0;
		text-transform: uppercase;
	}

	.years {
		display: flex;
		flex-direction: row-reverse;
		gap: 0.9rem;
		grid-column: 2;
		grid-row: 2;
	}

	.empty {
		display: grid;
		gap: var(--gap-block);
		justify-items: center;
		padding: 2rem 1.25rem;
		text-align: center;
	}

	.empty h2 {
		margin: 0;
	}

	.empty p {
		margin: 0;
		max-width: 46ch;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		justify-content: center;
		margin-top: 0.4rem !important;
	}

	.headline,
	.tile {
		display: grid;
		gap: 0.6rem;
		padding: var(--pad-panel);
	}

	.headline p,
	.tile p,
	.tile h2 {
		margin: 0;
	}

	.big {
		color: var(--text-bright);
		font-size: clamp(1.7rem, 6vw, 2.6rem);
		font-weight: 700;
		letter-spacing: -0.01em;
		line-height: 1.15;
	}

	.stat {
		color: var(--text-bright);
		font-size: 1.4rem;
		font-weight: 650;
	}

	.bright {
		color: var(--text-bright);
	}

	.pair {
		display: grid;
		gap: var(--gap-view);
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
	}

	.bars {
		display: grid;
		gap: 0.55rem;
		list-style: none;
		margin: 0.3rem 0 0;
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

	.sky {
		display: grid;
		gap: 0.6rem;
	}

	.sky-chart {
		display: block;
		height: auto;
		overflow: visible;
		width: 100%;
	}

	.sky-half {
		display: none;
	}

	@media (max-width: 40rem) {
		.sky-whole {
			display: none;
		}

		.sky-half {
			display: block;
		}
	}

	.month {
		fill: var(--text-dim);
		font-size: 8px;
	}

	.star {
		fill: var(--text-dim);
		opacity: 0.35;
	}

	.star.future {
		opacity: 0.12;
	}

	.star.level-1,
	.star.level-2,
	.star.level-3 {
		fill: #fde68a;
		opacity: 1;
	}

	.star.level-2 {
		filter: drop-shadow(0 0 1.5px #fbbf24);
	}

	.star.level-3 {
		animation: twinkle 4s ease-in-out infinite;
		fill: #fff7d6;
		filter: drop-shadow(0 0 2.5px #fbbf24);
	}

	@keyframes twinkle {
		50% {
			opacity: 0.75;
		}
	}

	.sky-summary {
		font-size: var(--text-secondary);
	}

	.goals {
		display: grid;
		gap: 0.6rem 1.2rem;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.goals li {
		align-items: center;
		display: flex;
		gap: 0.7rem;
	}

	.ring {
		flex: none;
		height: 2.75rem;
		overflow: visible;
		width: 2.75rem;
	}

	.ring-track {
		fill: none;
		stroke: rgba(148, 163, 214, 0.2);
		stroke-width: 2.4;
	}

	.ring-fill {
		fill: none;
		stroke: var(--color);
		stroke-linecap: round;
		stroke-width: 2.4;
		transform: rotate(-90deg);
		transform-origin: 22px 22px;
	}

	.goal-copy {
		display: grid;
		gap: 0.1rem;
		min-width: 0;
	}

	.goal-copy .muted {
		font-size: var(--text-secondary);
	}

	.lines {
		display: grid;
		gap: 0.45rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.lines li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.8rem;
		justify-content: space-between;
	}

	.result--closed {
		color: var(--success);
	}

	.notes {
		display: grid;
		gap: 0.9rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.notes blockquote {
		border-left: 2px solid var(--accent);
		color: var(--text-bright);
		margin: 0 0 0.25rem;
		padding-left: 0.8rem;
		white-space: pre-line;
	}

	.notes p {
		font-size: var(--text-secondary);
		padding-left: 0.9rem;
	}

	.compare {
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		width: 100%;
	}

	.compare th,
	.compare td {
		border-bottom: 1px solid var(--space-border);
		padding: 0.45rem 0.4rem;
		text-align: right;
	}

	.compare th[scope='row'] {
		color: var(--text);
		font-weight: 500;
		text-align: left;
	}

	.compare thead th {
		color: var(--text-dim);
		font-size: var(--text-secondary);
	}

	.compare tbody td:last-child {
		color: var(--text-bright);
		font-weight: 600;
	}

	.footnote {
		font-size: var(--text-secondary);
		margin: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.star.level-3 {
			animation: none;
		}
	}

	/*
	 * On paper: ink on white, no starfield and no chrome. `:has()` scopes the
	 * palette swap to a page that holds the review, so printing anything else
	 * after visiting this one is untouched by it.
	 */
	@media print {
		:global(html:has(.year-review)) {
			--text-bright: #0b0f2a;
			--text: #22284a;
			--text-dim: #4b5276;
			--space-surface: transparent;
			--space-mid: #e4e6f0;
			--space-border: #c9cce0;
			--space-border-bright: #c9cce0;
			--success: #047857;
			--accent: #6d28d9;
			--accent-warm: #92400e;
			background: #fff;
			color: #22284a;
		}

		:global(html:has(.year-review) body) {
			background: #fff;
		}

		:global(html:has(.year-review) .starfield),
		:global(html:has(.year-review) .masthead),
		:global(html:has(.year-review) .footer),
		:global(html:has(.year-review) .quick-add),
		.years,
		.footnote {
			display: none !important;
		}

		.panel {
			backdrop-filter: none;
			border: 1px solid var(--space-border);
			box-shadow: none;
			break-inside: avoid;
		}

		.notes li {
			break-inside: avoid;
		}

		/* Paper is wide enough for the whole sky, whatever the screen was. */
		.sky-whole {
			display: block;
		}

		.sky-half {
			display: none;
		}

		.star {
			fill: #c9cce0;
			opacity: 1;
		}

		.star.future {
			opacity: 0.4;
		}

		.star.level-1,
		.star.level-2,
		.star.level-3 {
			fill: #b45309;
			filter: none;
		}

		.bar-fill,
		.ring-fill {
			print-color-adjust: exact;
		}
	}
</style>
