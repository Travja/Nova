<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { celebration } from '$lib/celebration.svelte';
	import { driftAge, driftBand, type Asteroid } from '$domain/asteroids';
	import { orbitStanding, type GoalSnapshot } from '$domain/progress';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import { universeTree } from '$domain/universe';
	// Types only: erased at build, so nothing here pulls three into this chunk.
	import type {
		Closing,
		Picked,
		SceneGoal,
		UniverseInput,
		UniverseView,
		ZoomStop
	} from '$lib/universe';

	/**
	 * The universe view (#11): every goal in one sky you can fly.
	 *
	 * The canvas is decorative, like every orbit visual in Nova, and is created
	 * on mount — three.js is imported dynamically in `onMount`, so nothing
	 * three-shaped runs on the server and the tiers view never downloads it.
	 * What the server renders is everything that works without it: the zoom,
	 * the note and the list below, which is the universe in words and the
	 * keyboard's way in (decision 15).
	 *
	 * Logging never happens here. A tap shows a card whose Open asks the page
	 * for the one `GoalRowSheet` it already holds — the same sheet the list rows
	 * open — so a closing logged from the universe bursts in that sheet's own
	 * dial, and the universe only lights the ring (decision 12).
	 */

	interface Props {
		snapshots: readonly GoalSnapshot[];
		asteroids: readonly Asteroid[];
		/** The page's clock, for how far each rock has drifted. */
		now: Date;
		/** Open the page's sheet for a goal. */
		onopen: (goalId: string) => void;
		/** True while that sheet is open over the view. */
		covered: boolean;
		/** The list of every goal, rendered by the page. Rows carry `data-goal-id`. */
		children: Snippet;
	}

	let { snapshots, asteroids, now, onopen, covered, children }: Props = $props();

	const DAY_MS = 24 * 60 * 60 * 1000;
	/** The slider's range. Stops sit evenly across it; the renderer thinks in 0–1. */
	const ZOOM_STEPS = 100;
	/** Tabbing down the list should not send the camera on a tour (decision 15). */
	const FOCUS_DEBOUNCE_MS = 300;
	const FALLBACK = "This device can't draw the universe — every goal is listed below.";

	const tree = $derived(universeTree(snapshots, asteroids, now));

	/** The zoom's stops, along the home chain; a stop with nothing in it is not on the slider. */
	const stops = $derived.by((): ZoomStop[] => {
		const chain: ZoomStop[] = [];
		if (tree.home) chain.push({ id: tree.home.id, label: 'Home' });
		if (tree.galaxy) chain.push({ id: tree.galaxy.id, label: 'Galaxy' });
		if (tree.universe) chain.push({ id: tree.universe.id, label: 'Universe' });
		chain.push({ id: tree.root.id, label: 'Multiverse' });
		return chain;
	});

	/** What the tree does not carry: each goal's words and colour. */
	const goals = $derived(
		Object.fromEntries(
			snapshots.map((snapshot): [string, SceneGoal] => [
				snapshot.goal.id,
				{
					title: snapshot.goal.title,
					color: snapshot.goal.color,
					percent: Math.round(snapshot.current.ratio * 100)
				}
			])
		)
	);

	const input = $derived<UniverseInput>({ tree, goals, stops });

	/**
	 * Where it opens: Home when there is one — where the daily and weekly goals
	 * are — otherwise Multiverse. Always there, never a remembered camera.
	 */
	let zoom = $state(untrack(() => (tree.home ? 0 : ZOOM_STEPS)));
	const nearestStop = $derived(
		stops[Math.round((zoom / ZOOM_STEPS) * (stops.length - 1))] ?? stops[stops.length - 1]
	);

	type ViewState = 'loading' | 'ready' | 'lost' | 'failed';
	let viewState = $state<ViewState>('loading');
	let stage = $state<HTMLDivElement>();
	let zoomElement = $state<HTMLDivElement>();
	let view = $state.raw<UniverseView | null>(null);
	let picked = $state<Picked | null>(null);

	onMount(() => {
		let cancelled = false;

		(async () => {
			try {
				const { mountUniverse } = await import('$lib/universe');
				if (cancelled || !stage) return;
				view = mountUniverse(stage, input, {
					zoom: zoom / ZOOM_STEPS,
					onpick(next) {
						picked = next;
					},
					onzoom(value) {
						zoom = Math.round(value * ZOOM_STEPS);
					},
					onstate(next) {
						viewState = next;
					},
					// The zoom's words and its track, not the whole column beside them.
					avoid: () => (zoomElement ? [...zoomElement.querySelectorAll('span, input')] : [])
				});
			} catch {
				// No WebGL context, or — installed and offline before the view was
				// ever opened — no chunk to import. Either way, the list works.
				viewState = 'failed';
			}
		})();

		return () => {
			cancelled = true;
			clearTimeout(focusTimer);
			view?.destroy();
			view = null;
		};
	});

	// A log re-renders the page with new snapshots; the renderer sweeps from
	// what it showed to what is true now, over the same `SWEEP_MS` a dial does.
	let lastInput: UniverseInput | null = null;
	$effect(() => {
		const next = input;
		if (viewState !== 'ready' || !view) return;
		if (lastInput === null) {
			lastInput = next;
			return;
		}
		if (lastInput === next) return;
		lastInput = next;
		view.update(next);
	});

	$effect(() => {
		const current = celebration();
		if (viewState !== 'ready' || !view) return;
		const closing: Closing | null =
			current && goals[current.goalId]
				? {
						goalId: current.goalId,
						rays: current.shape.rays,
						ms: current.shape.ms,
						stamp: current.stamp
					}
				: null;
		view.celebrate(closing);
	});

	$effect(() => {
		const isCovered = covered;
		if (viewState !== 'ready' || !view) return;
		view.setCovered(isCovered);
	});

	/** Words for the live region: what reduced motion and screen readers get in place of the rays. */
	const announcement = $derived.by(() => {
		const current = celebration();
		return current ? `${current.title} closed its orbit` : '';
	});

	function onZoomInput(event: Event) {
		zoom = Number((event.currentTarget as HTMLInputElement).value);
		picked = null;
		view?.zoomTo(zoom / ZOOM_STEPS);
	}

	/* The card: a goal's standing, or what a rock is and how long it has drifted. */
	const pickedGoal = $derived.by(() => {
		const current = picked;
		if (current?.kind !== 'goal') return null;
		return snapshots.find((snapshot) => snapshot.goal.id === current.goalId) ?? null;
	});
	const pickedRock = $derived.by(() => {
		const current = picked;
		if (current?.kind !== 'rock') return null;
		return asteroids.find((rock) => rock.id === current.id) ?? null;
	});
	const orbiting = $derived(
		pickedGoal
			? snapshots.filter((snapshot) => snapshot.goal.parentId === pickedGoal.goal.id).length
			: 0
	);

	function sentence(text: string): string {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	const BAND_WORDS = { fresh: 'fresh', drifting: 'drifting', faint: 'at the edge of the belt' };

	function rockStanding(rock: Asteroid): string {
		const days = Math.floor(driftAge(rock, now) / DAY_MS);
		return `Untouched ${days} ${days === 1 ? 'day' : 'days'} · ${BAND_WORDS[driftBand(rock, now)]}`;
	}

	/**
	 * Keyboard focus on a row flies the camera to that goal — only on
	 * `:focus-visible`, so a tap on a row does not also send the camera off,
	 * and debounced so tabbing down the list is not a tour.
	 */
	let focusTimer: ReturnType<typeof setTimeout> | undefined;
	function onListFocus(event: FocusEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
		const goalId = target.closest<HTMLElement>('[data-goal-id]')?.dataset.goalId;
		if (!goalId) return;
		clearTimeout(focusTimer);
		focusTimer = setTimeout(() => view?.flyTo(goalId), FOCUS_DEBOUNCE_MS);
	}

	const belt = $derived(asteroids.length);
</script>

<section class="universe">
	<div class="universe__view" data-state={viewState}>
		<!-- The canvas and its labels land here on mount. Decorative: the list
		     below says everything in words and is how a keyboard gets in. -->
		<div class="universe__stage" bind:this={stage} aria-hidden="true"></div>

		{#if viewState === 'failed'}
			<p class="universe__fallback">{FALLBACK}</p>
		{/if}
		<noscript>
			<p class="universe__fallback">The universe needs JavaScript — every goal is listed below.</p>
		</noscript>

		{#if stops.length > 1}
			<div class="zoom" bind:this={zoomElement}>
				<div class="zoom__ticks" aria-hidden="true">
					{#each stops as stop, index (stop.id)}
						<span
							class:is-near={stop === nearestStop}
							style="bottom: {(index / (stops.length - 1)) * 100}%">{stop.label}</span
						>
					{/each}
				</div>
				<input
					type="range"
					min="0"
					max={ZOOM_STEPS}
					step="1"
					value={zoom}
					aria-label="Zoom"
					aria-valuetext={nearestStop.label}
					oninput={onZoomInput}
				/>
			</div>
		{/if}

		{#if pickedGoal}
			{@const tier = TIER_DEFINITIONS[pickedGoal.goal.tier]}
			<div class="card" style="--tier: {tier.accent}">
				<div class="card__row">
					<div>
						<div class="card__tier">{tier.label}</div>
						<div class="card__title">{pickedGoal.goal.title}</div>
					</div>
					<button type="button" class="button" onclick={() => onopen(pickedGoal.goal.id)}>
						Open
					</button>
				</div>
				<p class="card__standing">
					{sentence(orbitStanding(pickedGoal.current))}{#if orbiting > 0}
						· {orbiting} {orbiting === 1 ? 'goal orbits' : 'goals orbit'} it{/if}
				</p>
			</div>
		{:else if pickedRock}
			<div class="card" style="--tier: #d6c6a4">
				<div class="card__row">
					<div>
						<div class="card__tier">Asteroid</div>
						<div class="card__title">{pickedRock.title}</div>
					</div>
					<a class="button" href="{resolve('/today')}#belt">Open in Today</a>
				</div>
				<p class="card__standing">{rockStanding(pickedRock)}</p>
			</div>
		{/if}
	</div>

	<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>

	<p class="universe__note muted">
		Every goal is in the universe. Tap a body to fly to it, or pick one below.
		{#if belt > 0}
			<a href="{resolve('/today')}#belt">{belt} {belt === 1 ? 'asteroid' : 'asteroids'}</a>
			{belt === 1 ? 'circles' : 'circle'} the home star.
		{/if}
	</p>

	<!-- The universe in words. Focus here, from a keyboard, flies the camera. -->
	<div class="universe__list" onfocusin={onListFocus}>
		{@render children()}
	</div>
</section>

<style>
	.universe {
		display: grid;
		gap: var(--gap-block);
	}

	/* Most of a phone screen, never all of it, so the page can always be
	   scrolled past it to the list. The canvas takes every touch — the page
	   scrolls by the header above and the list below. */
	.universe__view {
		background: radial-gradient(120% 90% at 50% 40%, #0b1030, var(--space-void, #04050d) 70%);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-lg);
		height: min(72svh, 640px);
		overflow: hidden;
		position: relative;
		touch-action: none;
	}

	.universe__stage {
		inset: 0;
		position: absolute;
	}

	.universe__stage :global(.universe-canvas) {
		display: block;
	}

	.universe__stage :global(.universe-labels) {
		inset: 0;
		pointer-events: none;
		position: absolute;
	}

	.universe__stage :global(.universe-label) {
		color: var(--text-bright);
		font-size: 11px;
		font-weight: 600;
		padding-bottom: 10px;
		pointer-events: none;
		text-shadow:
			0 0 4px #04050d,
			0 0 8px #04050d;
		white-space: nowrap;
	}

	.universe__stage :global(.universe-label small) {
		color: var(--text-dim);
		font-size: inherit;
		font-weight: 500;
		margin-left: 0.3em;
	}

	.universe__fallback {
		color: var(--text);
		inset: 0;
		margin: 0;
		padding: 1.5rem;
		place-content: center;
		position: absolute;
		text-align: center;
		display: grid;
	}

	/* The zoom: one continuous scale from the home system out to the
	   multiverse. A real range, so a keyboard and a single tap both work. Top
	   is out, bottom is in. */
	/* Only the slider itself takes a pointer: the ticks beside it are words,
	   and a tap on a body behind them has to reach the canvas. */
	.zoom {
		align-items: stretch;
		display: flex;
		gap: 4px;
		height: 58%;
		pointer-events: none;
		position: absolute;
		right: 6px;
		top: 24%;
	}

	.zoom input {
		pointer-events: auto;
		accent-color: var(--accent, #a78bfa);
		direction: rtl;
		margin: 0;
		width: 28px;
		writing-mode: vertical-lr;
	}

	.zoom__ticks {
		position: relative;
		width: 70px;
	}

	.zoom__ticks span {
		color: var(--text-dim);
		font-size: 10px;
		letter-spacing: 0.06em;
		position: absolute;
		right: 0;
		text-shadow: 0 0 4px #04050d;
		text-transform: uppercase;
		transform: translateY(50%);
	}

	.zoom__ticks span.is-near {
		color: var(--text-bright);
	}

	/* Over the top of the view, clear of the zoom below it — the bottom
	   corner is where the floating quick-add sits on a phone. */
	.card {
		backdrop-filter: blur(6px);
		background: var(--space-surface);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-lg);
		display: grid;
		gap: 0.2rem;
		left: 12px;
		padding: 0.7rem 0.9rem;
		position: absolute;
		right: 12px;
		top: 12px;
	}

	.card__row {
		align-items: center;
		display: flex;
		gap: 0.6rem;
		justify-content: space-between;
	}

	.card__row .button {
		flex: none;
		white-space: nowrap;
	}

	.card__title {
		color: var(--text-bright);
		font-weight: 650;
	}

	.card__tier {
		color: var(--tier);
		font-size: 0.7rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.card__standing {
		color: var(--text-dim);
		font-size: var(--text-secondary);
		margin: 0;
	}

	.universe__note {
		font-size: var(--text-secondary);
		margin: 0;
	}

	.universe__list {
		display: grid;
		gap: var(--gap-list);
	}
</style>
