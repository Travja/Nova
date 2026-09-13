<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { GoalSnapshot } from '$domain/progress';
	import type { TierDefinition } from '$domain/tiers';

	/**
	 * One tier's goals as a sortable list.
	 *
	 * Dragging is the enhancement; the move buttons are the route that works
	 * from a keyboard, a screen reader, or with no JavaScript at all, since each
	 * one is an ordinary form post.
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
		onannounce?.(`${title} moved to position ${to + 1} of ${ids.length} in ${tier.label}.`);

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

			<form class="moves" method="POST" action="?/move&reorder=1" use:enhance>
				<input type="hidden" name="goalId" value={goal.id} />
				<input type="hidden" name="title" value={goal.title} />
				<button
					class="move"
					type="submit"
					name="direction"
					value="up"
					disabled={index === 0}
					aria-label="Move {goal.title} up"
				>
					↑
				</button>
				<button
					class="move"
					type="submit"
					name="direction"
					value="down"
					disabled={index === goals.length - 1}
					aria-label="Move {goal.title} down"
				>
					↓
				</button>
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

	.move {
		background: rgba(6, 9, 26, 0.7);
		border: 1px solid var(--space-border);
		border-radius: var(--radius-sm);
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		line-height: 1;
		min-height: 2.25rem;
		min-width: 2.25rem;
	}

	.move:hover:not(:disabled) {
		border-color: var(--space-border-bright);
	}

	.move:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
</style>
