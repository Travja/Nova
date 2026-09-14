<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { focusTarget } from '$lib/focus';
	import { tick } from 'svelte';
	import type { GoalSnapshot } from '$domain/progress';
	import type { TierDefinition } from '$domain/tiers';

	/**
	 * One tier's goals as a sortable list.
	 *
	 * Dragging is the enhancement; the move buttons are the route that works
	 * from a keyboard, a screen reader, or with no JavaScript at all, since each
	 * one is an ordinary form post.
	 *
	 * A keyboard move has to survive two things a drag does not. It is announced
	 * from here rather than from the server's reply, which only ever said "X
	 * moved within its tier" and, worse, was shadowed for the rest of the session
	 * by the first drag's message — so a keyboard user got one announcement and
	 * then silence. And the button pressed can be the button that disables itself
	 * by working: moving a goal to the top takes "up" away, so focus is handed to
	 * the other arrow on the same goal, which is where the next move is anyway.
	 *
	 * The announcement goes out off `result`, before `update()` applies it. That
	 * ordering is the whole of it: `update()` is what puts `form.moved` on the
	 * page, and the page falls back to the server's weaker sentence whenever this
	 * component has not spoken yet. Announce afterwards and a live region gets two
	 * changes for one keypress — "Beta moved within its tier", then the real one —
	 * which is either read twice or read wrong depending on the timing.
	 */
	interface Props {
		tier: TierDefinition;
		goals: GoalSnapshot[];
		/** Told what changed, so the page can put it in its live region. */
		onannounce?: (message: string) => void;
	}

	let { tier, goals, onannounce }: Props = $props();

	let draggingId: string | null = $state(null);
	let overId: string | null = $state(null);
	let orderForm: HTMLFormElement;
	let orderInput: HTMLInputElement;
	const MOVES = [
		{ direction: 'up', glyph: '↑' },
		{ direction: 'down', glyph: '↓' }
	] as const;

	/**
	 * The arrows, by goal then direction, so a move can put focus back.
	 *
	 * A plain record rather than a `Map`: nothing renders off it, it is only ever
	 * read inside the handler that has just moved something, and a reactive
	 * collection here would be re-running the list for a bookkeeping write.
	 */
	const arrows: Record<string, HTMLButtonElement | undefined> = {};

	function arrowKey(goalId: string, direction: 'up' | 'down'): string {
		return `${goalId}:${direction}`;
	}

	/** Where a goal sits now, said the way the list reads it. */
	function placement(title: string, position: number, total: number): string {
		return `${title} moved to position ${position} of ${total} in ${tier.label}.`;
	}

	/**
	 * Where one step in a direction puts a row, clamped to the ends.
	 *
	 * Worked out from the index the row had when the button was pressed, captured
	 * in the template. Reading it back afterwards would be reading the answer —
	 * the list has already re-rendered in the new order by then — and moving it a
	 * second time.
	 */
	function landedAt(from: number, direction: 'up' | 'down', total: number): number {
		return Math.min(Math.max(from + (direction === 'up' ? -1 : 1), 0), total - 1);
	}

	/** Put focus back on the row that just moved, once it has re-rendered. */
	async function restoreFocus(goalId: string, direction: 'up' | 'down') {
		await tick();
		const pressed = arrows[arrowKey(goalId, direction)];
		// Reaching an end disables the arrow that got you there; the other one on
		// the same row is the only place focus can go that is still about this goal.
		const fallback = arrows[arrowKey(goalId, direction === 'up' ? 'down' : 'up')];
		focusTarget(pressed && !pressed.disabled ? pressed : fallback);
	}

	function drop(targetId: string) {
		const ids = goals.map((snapshot) => snapshot.goal.id);
		const from = draggingId ? ids.indexOf(draggingId) : -1;
		const to = ids.indexOf(targetId);
		draggingId = null;
		overId = null;
		if (from < 0 || to < 0 || from === to) return;

		const [moved] = ids.splice(from, 1);
		ids.splice(to, 0, moved);

		const title = goals.find((snapshot) => snapshot.goal.id === moved)?.goal.title ?? 'Goal';
		onannounce?.(placement(title, to + 1, ids.length));

		orderInput.value = ids.join(',');
		orderForm.requestSubmit();
	}
</script>

<form bind:this={orderForm} method="POST" action="?/reorder&reorder=1" use:enhance>
	<input type="hidden" name="tier" value={tier.id} />
	<input bind:this={orderInput} type="hidden" name="order" value="" />
</form>

<ol class="order">
	{#each goals as snapshot, index (snapshot.goal.id)}
		{@const goal = snapshot.goal}
		<li
			class="row"
			class:row--dragging={draggingId === goal.id}
			class:row--over={overId === goal.id && draggingId !== goal.id}
			draggable="true"
			ondragstart={() => (draggingId = goal.id)}
			ondragend={() => ((draggingId = null), (overId = null))}
			ondragover={(event) => {
				event.preventDefault();
				overId = goal.id;
			}}
			ondrop={(event) => {
				event.preventDefault();
				drop(goal.id);
			}}
		>
			<span class="handle" aria-hidden="true">⠿</span>
			<span class="position muted">{index + 1}</span>
			<span class="dot" style="background: {goal.color}"></span>
			<a class="title" href={resolve('/goals/[id]', { id: goal.id })}>{goal.title}</a>

			<form
				class="moves"
				method="POST"
				action="?/move&reorder=1"
				use:enhance={({ formData }) => {
					const direction = formData.get('direction') === 'up' ? 'up' : 'down';
					// Read off `goals` rather than the each-block's `index`. The submit
					// function is built once, when the action attaches, and the row it
					// belongs to moves under it on every reorder — so a second press on
					// the same arrow was still announcing the first press's position.
					// The prop is live and the goal's id is not, which makes this the
					// pair that cannot go stale.
					const from = goals.findIndex((snapshot) => snapshot.goal.id === goal.id);
					const total = goals.length;
					return async ({ result, update }) => {
						// Before `update()`, so the server's fallback sentence never
						// reaches the live region — see the note at the top.
						if (result.type === 'success' && from >= 0) {
							onannounce?.(placement(goal.title, landedAt(from, direction, total) + 1, total));
						} else {
							// A move the server refused renders its own error, and a
							// stale "moved to position 2" sitting above it would be the
							// page disagreeing with itself.
							onannounce?.('');
						}
						await update();
						await restoreFocus(goal.id, direction);
					};
				}}
			>
				<input type="hidden" name="goalId" value={goal.id} />
				<input type="hidden" name="title" value={goal.title} />
				{#each MOVES as move (move.direction)}
					<button
						{@attach (node) => {
							const key = arrowKey(goal.id, move.direction);
							arrows[key] = node;
							return () => delete arrows[key];
						}}
						class="move tap"
						type="submit"
						name="direction"
						value={move.direction}
						disabled={move.direction === 'up' ? index === 0 : index === goals.length - 1}
						aria-label="Move {goal.title} {move.direction}"
					>
						<span aria-hidden="true">{move.glyph}</span>
					</button>
				{/each}
			</form>
		</li>
	{/each}
</ol>

<style>
	.order {
		display: grid;
		gap: 0.4rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		align-items: center;
		background: rgba(10, 14, 36, 0.55);
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		display: grid;
		gap: 0.7rem;
		grid-template-columns: auto auto auto 1fr auto;
		padding: 0.5rem 0.75rem;
	}

	.row--dragging {
		opacity: 0.5;
	}

	.row--over {
		border-color: var(--space-border-bright);
	}

	.handle {
		color: var(--text-dim);
		cursor: grab;
		font-size: 1rem;
		line-height: 1;
	}

	.position {
		font-size: 0.8rem;
		min-width: 1.2ch;
		text-align: right;
	}

	.dot {
		border-radius: 50%;
		height: 0.6rem;
		width: 0.6rem;
	}

	.title {
		color: var(--text-bright);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.moves {
		display: flex;
		gap: 0.3rem;
	}

	/*
	 * Sized by `.tap`, like every other control. These were 36px square, which is
	 * under the floor `--tap-min` exists to hold — and they are the whole of the
	 * keyboard and touch route through reordering, so they were the worst place
	 * in the app to be eight pixels short.
	 */
	.move {
		background: rgba(6, 9, 26, 0.7);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-sm);
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		line-height: 1;
	}

	.move:hover:not(:disabled) {
		border-color: var(--space-border-bright);
	}

	.move:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
</style>
