<script lang="ts">
	import Asteroid from '$components/Asteroid.svelte';
	import AsteroidDetails from '$components/AsteroidDetails.svelte';
	import {
		atBeltEdge,
		driftBand,
		driftFraction,
		driftLabel,
		offersRelease,
		swipeIntent,
		swipeOffset
	} from '$domain/asteroids';
	import type { Asteroid as AsteroidData } from '$domain/asteroids';

	/**
	 * One rock on the belt: what it is, how long it has been out there, and the
	 * three ways it can leave.
	 *
	 * Finishing and releasing sit side by side and are drawn at the same weight
	 * on purpose. Releasing is a legitimate ending, not a failure — the whole
	 * point of drift is that the belt never becomes a ledger of things not done
	 * — so nothing here dresses one of them up as the right answer.
	 *
	 * The button says Done and the state it writes is still called `cleared`:
	 * the three terminal states are settled vocabulary the export in #17 is
	 * scoped against, and what a person reads is a different question.
	 *
	 * Two lines and no third. The title and the drift *are* the disclosure —
	 * there is nothing labelling the way in, because the words you would tap it
	 * from are the way in, which is the bargain the goal row already makes. The
	 * endings are taken out of flow and pinned to the corner, so the panel can
	 * open across the row's whole width rather than whatever is left beside two
	 * buttons.
	 *
	 * The drift always takes its short form here. The long one is a sentence,
	 * and a sentence beside two controls on a phone is a sentence with its end
	 * cut off; the sheet's header has the room and uses it there.
	 *
	 * A row can also be swiped: right to finish, left to let go. That is an
	 * enhancement over the two marks and never a replacement for them — it
	 * needs a pointer, a script and a hand, and the belt has to work without
	 * any of the three. What it does when a swipe commits is press the same
	 * button the thumb could have pressed.
	 */

	interface Props {
		asteroid: AsteroidData;
		/** The request's clock, so every rock is measured against one instant. */
		now: Date;
		/** `?/…` paths on the page that owns this row. */
		clearAction: string;
		releaseAction: string;
		editAction: string;
		/**
		 * Asked to open this asteroid's sheet, which compact rows do instead of
		 * expanding in place. Left out — the default density, no JavaScript, or
		 * no `<dialog>` — and the disclosure below opens the ordinary way.
		 */
		onopen?: (id: string) => void;
	}

	let { asteroid, now, clearAction, releaseAction, editAction, onopen }: Props = $props();

	/**
	 * The disclosure is the enhancement's own fallback. Its contents are in the
	 * page either way, so a browser that cannot open the sheet — no JavaScript,
	 * no `<dialog>` — still has every one of them a tap away, which is what the
	 * belt promises about letting a one-off go.
	 */
	function openSheet(event: MouseEvent) {
		// A drag that turned sideways is a swipe, and the click the browser
		// sends afterwards is the tap it started life as. Swallow it, at every
		// density: without this a swipe at the default density would finish the
		// rock and expand its panel on the way out.
		if (swiped) {
			swiped = false;
			event.preventDefault();
			return;
		}

		if (!onopen) return;
		if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
		event.preventDefault();
		onopen(asteroid.id);
	}

	const band = $derived(driftBand(asteroid, now));
	const drift = $derived(driftFraction(asteroid, now));
	/** Whether this rock has drifted as far as the belt goes. */
	const adrift = $derived(atBeltEdge(asteroid, now));
	/**
	 * Whether letting go is one of the row's own controls yet. While it is not,
	 * it is still one tap inside the disclosure below — hidden from the row, not
	 * taken away.
	 */
	const canRelease = $derived(offersRelease(asteroid, now));

	/* ---- Swiping ------------------------------------------------------ */

	/**
	 * How far a finger travels before the row decides a drag is sideways.
	 *
	 * Below this nothing moves and nothing is claimed, which is what leaves the
	 * page free to scroll through a row: the first few pixels belong to
	 * whichever direction they turn out to be going in, and only a horizontal
	 * answer takes the pointer.
	 */
	const SLOP = 10;

	let plate: HTMLElement | null = $state(null);
	let doneForm: HTMLFormElement | null = $state(null);
	let releaseForm: HTMLFormElement | null = $state(null);

	let offset = $state(0);
	let width = $state(0);
	let dragging = $state(false);

	/** Set the moment a drag turns sideways, so the tap it started as does not
	    also open the sheet when the finger lifts. */
	let swiped = false;
	let pointer: number | null = null;
	let startX = 0;
	let startY = 0;
	let axis: 'x' | 'y' | null = null;

	const context = $derived({ width, canRelease });
	/** What letting go right now would do — drawn under the row as it moves. */
	const intent = $derived(dragging ? swipeIntent(offset, context) : null);

	/** Anything that has its own idea of what a press and a drag mean. */
	const OWN_GESTURE = 'a, button, input, select, textarea';

	function press(event: PointerEvent) {
		// A press that lands on a control is that control's. Dragging sideways
		// out of the title field would otherwise swipe the row away rather than
		// select the word under the finger.
		if ((event.target as HTMLElement | null)?.closest(OWN_GESTURE)) return;
		if (event.button !== 0) return;

		pointer = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		axis = null;
		swiped = false;
		width = plate?.clientWidth ?? 0;
	}

	function drag(event: PointerEvent) {
		if (pointer !== event.pointerId) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (!axis) {
			if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
			axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
			if (axis === 'x') {
				dragging = true;
				swiped = true;
				// Keeps the rest of the gesture coming here even once the finger
				// has left the row it started on.
				try {
					plate?.setPointerCapture(event.pointerId);
				} catch {
					// Synthetic pointers have nothing to capture, and neither do
					// browsers without the API. The drag works either way.
				}
			}
		}

		if (axis !== 'x') return;
		offset = swipeOffset(dx, context);
	}

	function release(event: PointerEvent) {
		if (pointer !== event.pointerId) return;

		const settled = axis === 'x' ? swipeIntent(offset, context) : null;
		pointer = null;
		axis = null;
		dragging = false;
		offset = 0;

		// Pressing the button the thumb could have pressed, rather than posting
		// anything of its own: one path to each ending, whichever way it was
		// asked for.
		const form = settled === 'done' ? doneForm : settled === 'release' ? releaseForm : null;
		form?.requestSubmit();
	}
</script>

<li
	class="rock"
	data-band={band}
	data-intent={intent ?? undefined}
	data-dragging={dragging ? 'true' : undefined}
	onpointerdown={press}
	onpointermove={drag}
	onpointerup={release}
	onpointercancel={release}
>
	<!--
		What the row is about to do, revealed as it moves off it. Finishing sits
		on the left because that is the side a rightward swipe uncovers, and
		letting go on the right for the same reason — each mark is where the
		gesture that means it is coming from.
	-->
	<div class="under" aria-hidden="true">
		<div class="under__side under__side--done"><span class="under__mark">✓</span></div>
		<div class="under__side under__side--release">
			{#if canRelease}<span class="under__mark">↗</span>{/if}
		</div>
	</div>

	<div
		class="plate panel"
		class:plate--dragging={dragging}
		class:plate--solo={!canRelease}
		style="--dx: {offset}px"
		bind:this={plate}
	>
		<Asteroid seed={asteroid.id} {drift} {band} />

		<!--
			The words are the disclosure. There is no "More" to find because the
			thing you would tap it from is already the thing you tap — the same
			bargain the goal row makes, where the row itself opens the sheet and
			nothing has to label the way in.

			The two endings stay outside it: a `<summary>` may not hold interactive
			content, and a control nested in one is a control the browser is
			entitled to swallow.
		-->
		<details class="tweak">
			<summary class="face" onclick={openSheet}>
				<span class="title">{asteroid.title}</span>
				<!-- The separators are non-breaking on purpose: the space before a `·`
				     sits at the start of an inline element, where ordinary whitespace
				     is trimmed away and the dot ends up welded to the word before it. -->
				<span class="meta muted">
					{driftLabel(asteroid, now, 'short')}{#if adrift}<span class="edge"
							>&nbsp;· at the edge</span
						>{/if}{#if asteroid.note}<span class="note">&nbsp;· {asteroid.note}</span>{/if}
				</span>
			</summary>

			<AsteroidDetails {asteroid} {clearAction} {editAction} {releaseAction} />
		</details>

		<!--
			No buttons, and no submit in either: a committed swipe calls
			`requestSubmit()` on the matching one, and everything that is not a
			swipe goes through the panel above, where the same two posts have
			names and are reachable by tab.
		-->
		<form method="POST" action={clearAction} bind:this={doneForm}>
			<input type="hidden" name="id" value={asteroid.id} />
		</form>
		<form method="POST" action={releaseAction} bind:this={releaseForm}>
			<input type="hidden" name="id" value={asteroid.id} />
		</form>
	</div>
</li>

<style>
	/*
	 * Two columns: the mark, and everything that is not the mark. The endings
	 * are taken out of flow and pinned to the corner instead of holding a
	 * column of their own, so an open panel gets the row's whole width rather
	 * than whatever is left beside two buttons.
	 */
	/*
	 * The shell. It holds its place in the list and holds the marks a swipe
	 * uncovers; the plate above is what actually moves.
	 *
	 * `pan-y` hands vertical drags straight back to the page, so a list of
	 * these still scrolls under a thumb and only sideways is ours.
	 */
	.rock {
		border-radius: var(--radius-lg);
		/* The plate slides within the row rather than across the page. Without
		   this a swipe pushes the card past the viewport and the whole document
		   gains a sideways scrollbar for the length of the gesture. */
		overflow: hidden;
		position: relative;
		touch-action: pan-y;
	}

	.plate {
		align-items: center;
		display: grid;
		gap: 0 0.7rem;
		grid-template-columns: auto minmax(0, 1fr);
		padding: 0.35rem 0.7rem;
		position: relative;
		transform: translateX(var(--dx, 0));
		/*
		 * The snap back, and the one piece of this that is decoration — the drag
		 * itself is the finger's own movement and stays whatever the motion
		 * preference says. The global rule damps this to nothing, which is
		 * exactly right: the row still ends up where it belongs, it just gets
		 * there without the travel.
		 */
		transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	/*
	 * The standing hint: not a line, an atmosphere. Each end of the card carries
	 * a wash of the colour a drag that way would uncover, feathered far enough
	 * that there is no edge anywhere to read as a status stripe — a row simply
	 * has a warm end and a cool one, and the first swipe explains why.
	 *
	 * The stone end is drawn only where letting go is actually on offer, so a
	 * rock added a minute ago is warm at one end and plain at the other.
	 */
	.plate::after {
		background:
			linear-gradient(to right, rgba(52, 211, 153, 0.22), rgba(52, 211, 153, 0) 72px),
			linear-gradient(to left, rgba(168, 179, 212, 0.17), rgba(168, 179, 212, 0) 72px);
		border-radius: inherit;
		content: '';
		inset: 0;
		pointer-events: none;
		position: absolute;
	}

	.plate--solo::after {
		background: linear-gradient(to right, rgba(52, 211, 153, 0.22), rgba(52, 211, 153, 0) 72px);
	}

	/*
	 * While a finger is on it, the row is where the finger put it — and it is
	 * opaque, so the colour underneath reads as a layer the card is moving off
	 * rather than as a stain spreading through it.
	 *
	 * Two backgrounds rather than one flat colour: the image paints over the
	 * colour, so this is the theme's own glass laid on an opaque floor, and it
	 * stays the right shade in a palette that redefines either.
	 */
	.plate--dragging {
		background-color: var(--space-void);
		background-image: linear-gradient(var(--space-surface), var(--space-surface));
		transition: none;
	}

	/*
	 * The two endings, lying under the card until it moves off them. Each side
	 * is the colour of what it does — green for finishing, stone for letting go
	 * — so the direction is answered by the fill before the mark is close enough
	 * to read.
	 *
	 * Half the row each, and which half is which follows the gesture: finishing
	 * is on the left because that is the side a rightward swipe uncovers.
	 */
	.under {
		border-radius: inherit;
		display: grid;
		grid-template-columns: 1fr 1fr;
		inset: 0;
		/*
		 * Drawn only while a finger is on the row. A `.panel` is glass, so a
		 * colour lying under one is a colour showing faintly through it — and a
		 * belt of rows each half-tinted green by a gesture nobody is making is
		 * not what this is for.
		 */
		opacity: 0;
		position: absolute;
		transition: opacity 120ms ease;
	}

	.rock[data-dragging] .under {
		opacity: 1;
	}

	.under__side {
		align-items: center;
		display: flex;
		/* Dimmed until the drag commits, so the row says "not yet" and then
		   "now" without either being a surprise. */
		opacity: 0.55;
		padding: 0 1.15rem;
		transition: opacity 140ms ease;
	}

	.under__side--done {
		background: var(--success);
		color: #0b0a1f;
		justify-content: flex-start;
	}

	/*
	 * Stone rather than red. Letting go is a legitimate ending on equal footing
	 * with finishing, and a colour that means danger everywhere else in an
	 * interface would make it the one thing on the belt that looks like a
	 * mistake.
	 */
	.under__side--release {
		background: #5b6480;
		color: var(--text-bright);
		justify-content: flex-end;
	}

	.rock[data-intent='done'] .under__side--done,
	.rock[data-intent='release'] .under__side--release {
		opacity: 1;
	}

	.under__mark {
		font-size: 1.15rem;
		font-weight: 700;
		transition: transform 140ms ease;
	}

	.rock[data-intent='done'] .under__mark,
	.rock[data-intent='release'] .under__mark {
		transform: scale(1.2);
	}

	/*
	 * The mark takes the row's whole height rather than a fixed slice of the
	 * top of it, which is what lets the belt run the length of the card. The
	 * rock inside it stays vertically centred whatever the row grows to.
	 */
	.plate > :global(.asteroid) {
		align-self: stretch;
	}

	.tweak {
		min-width: 0;
	}

	/*
	 * The title and the drift, and the whole of the way in. No marker: a
	 * triangle beside a title is a second affordance for something the row is
	 * already offering, and the row says it the way the goal row does — by
	 * lighting up under a pointer.
	 */
	.face {
		cursor: pointer;
		display: grid;
		gap: 0.05rem;
		list-style: none;
		/* Nothing to clear any more: the row's whole width is its own. */
		padding: 0.3rem 0.2rem 0.3rem 0;
	}

	.face::-webkit-details-marker {
		display: none;
	}

	.plate:hover {
		border-color: var(--space-border-bright);
	}

	.title {
		color: var(--text-bright);
		/* Smaller than a goal's. The belt is the band you reach for when nothing
		   is due, and a one-off should not read at the weight of something in
		   orbit. */
		font-size: 0.94rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: block;
		font-size: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* A rock nobody has touched says so more quietly, not more loudly. */
	.rock[data-band='drifting'] .title {
		color: var(--text);
	}

	.rock[data-band='faint'] .title {
		color: var(--text);
		opacity: 0.82;
	}

	/*
	 * Three words rather than a sentence, and the same three on every rock that
	 * has got this far. What being at the edge means is said once by the band
	 * above — repeating it per row is how a belt turns back into a list of
	 * reproaches.
	 */
	.edge {
		color: var(--text);
	}

	/*
	 * Compact is a different shape, not the same one with less padding — the
	 * same move the goal row makes. The mark comes down, the row gives up the
	 * padding it was using to breathe, and the endings sit beside a drift that
	 * has been cut to its number. Two lines on a phone, against the four the
	 * default density wants.
	 */
	:global(html[data-density='compact']) .plate {
		--mark-width: 44px;
		padding: 0.2rem 0.55rem;
	}

	:global(html[data-density='compact']) .title {
		font-size: var(--text-secondary);
	}

	:global(html[data-density='compact']) summary {
		padding: 0;
	}
</style>
