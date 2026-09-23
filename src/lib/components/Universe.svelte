<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import AsteroidSheet from '$components/AsteroidSheet.svelte';
	import TierBody from '$components/TierBody.svelte';
	import { celebration } from '$lib/celebration.svelte';
	import type { Asteroid } from '$domain/asteroids';
	import { bodyVariant } from '$domain/bodies';
	import type { GoalSnapshot } from '$domain/progress';
	import type { Tier } from '$domain/tiers';
	import { universeTree } from '$domain/universe';
	// Types only: erased at build, so nothing here pulls three into this chunk.
	import type { Closing, SceneGoal, UniverseInput, UniverseView, ZoomStop } from '$lib/universe';

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
	 * Logging never happens on the canvas itself. A tap on a goal's body flies
	 * there and asks the page for the one `GoalRowSheet` it already holds — the
	 * same sheet the list rows open — so a closing logged from the universe
	 * bursts in that sheet's own dial, and the universe only lights the ring
	 * (decision 12). A tap on a rock opens the belt's own `AsteroidSheet`, whose
	 * endings post to Today's actions exactly as they do from Today.
	 *
	 * Each goal's body is the drawing its dial flies: the page renders every
	 * distinct `TierBody` once, hidden, and the renderer copies it onto a
	 * billboard (see `$lib/universe/art.ts`).
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

	/** One of the dial's bodies: which drawing, in which colour, lit or not. */
	interface BodyArt {
		key: string;
		tier: Tier;
		variant: number;
		color: string;
		dormant: boolean;
	}

	function artFor(snapshot: GoalSnapshot): BodyArt {
		const { goal } = snapshot;
		const variant = bodyVariant(goal.tier, goal.id);
		const dormant = snapshot.current.dormant;
		return {
			key: `${goal.tier}-${variant}-${goal.color}-${dormant ? 'dormant' : 'lit'}`,
			tier: goal.tier,
			variant,
			color: goal.color,
			dormant
		};
	}

	/** Every distinct body once: six goals flying the same drawing share one texture. */
	const bodies = $derived([
		...new Map(snapshots.map((snapshot) => artFor(snapshot)).map((art) => [art.key, art])).values()
	]);

	/** What the tree does not carry: each goal's words, colour and body. */
	const goals = $derived(
		Object.fromEntries(
			snapshots.map((snapshot): [string, SceneGoal] => [
				snapshot.goal.id,
				{
					title: snapshot.goal.title,
					color: snapshot.goal.color,
					percent: Math.round(snapshot.current.ratio * 100),
					art: artFor(snapshot).key
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
	let atlas = $state<HTMLDivElement>();
	let view = $state.raw<UniverseView | null>(null);
	/** The rock whose sheet is open, from a tap on the belt. */
	let openRockId = $state<string | null>(null);
	const openRock = $derived(asteroids.find((rock) => rock.id === openRockId) ?? null);
	const beltActions = {
		clear: `${resolve('/today')}?/clearAsteroid`,
		edit: `${resolve('/today')}?/editAsteroid`,
		release: `${resolve('/today')}?/releaseAsteroid`
	};

	onMount(() => {
		let cancelled = false;

		(async () => {
			try {
				const { mountUniverse } = await import('$lib/universe');
				if (cancelled || !stage) return;
				view = mountUniverse(stage, input, {
					zoom: zoom / ZOOM_STEPS,
					// A tap opens the sheet: a goal's is the page's, a rock's is ours.
					onpick(next) {
						if (next?.kind === 'goal') onopen(next.goalId);
						else if (next?.kind === 'rock') openRockId = next.id;
					},
					art: (key) =>
						atlas?.querySelector<SVGSVGElement>(`svg[data-art="${CSS.escape(key)}"]`) ?? null,
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
		const isCovered = covered || openRock !== null;
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
		view?.zoomTo(zoom / ZOOM_STEPS);
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
	</div>

	<!-- The dial's bodies, drawn once each for the renderer to copy. Never seen:
	     the canvas shows them. -->
	<div class="universe__art" bind:this={atlas} aria-hidden="true">
		{#each bodies as body (body.key)}
			<svg data-art={body.key} viewBox="-2 -2 4 4" style="--color: {body.color}">
				<TierBody
					tier={body.tier}
					variant={body.variant}
					cx={0}
					cy={0}
					r={1}
					dormant={body.dormant}
				/>
			</svg>
		{/each}
	</div>

	<AsteroidSheet
		asteroid={openRock}
		{now}
		clearAction={beltActions.clear}
		editAction={beltActions.edit}
		releaseAction={beltActions.release}
		onclose={() => (openRockId = null)}
	/>

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

	/* Out of sight and out of the flow, but laid out and styled, so the
	   renderer can read each drawing's paint. Still, so it reads a rest pose
	   rather than wherever an animation happened to be. */
	.universe__art {
		height: 0;
		overflow: hidden;
		position: absolute;
		width: 0;
	}

	.universe__art svg {
		height: 64px;
		width: 64px;
	}

	.universe__art :global(*) {
		animation: none !important;
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
