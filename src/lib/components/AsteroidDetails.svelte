<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Asteroid } from '$domain/asteroids';

	/**
	 * Everything about a one-off that is not its title, its drift or finishing
	 * it: rename it, give it a note, send it into orbit, or let it go.
	 *
	 * Drawn in two places and written once. At the default density it is the
	 * body of the row's own disclosure; in compact the row has no room for it
	 * and it becomes the body of a sheet instead — the same move the goal row
	 * makes with its card. Both copies exist in the DOM in compact, which is
	 * what keeps the disclosure working when the sheet cannot open, so the
	 * inputs take a prefix to stay unique.
	 */

	interface Props {
		asteroid: Asteroid;
		/** `?/…` paths on the page that owns this. */
		editAction: string;
		releaseAction: string;
		/** Keeps the field ids apart when the row and the sheet both render. */
		idPrefix?: string;
	}

	let { asteroid, editAction, releaseAction, idPrefix = '' }: Props = $props();

	const titleId = $derived(`${idPrefix}title-${asteroid.id}`);
	const noteId = $derived(`${idPrefix}note-${asteroid.id}`);
	/** Inlined into the attribute below rather than pre-joined, so the resolve
	    rule can see the route it is built from — the same shape the history
	    pager and the archive confirmation use. */
	const newGoalHref = resolve('/goals/new');
</script>

<form class="edit" method="POST" action={editAction}>
	<input type="hidden" name="id" value={asteroid.id} />
	<label class="visually-hidden" for={titleId}>Title</label>
	<input id={titleId} name="title" value={asteroid.title} maxlength="80" required />
	<label class="visually-hidden" for={noteId}>Note</label>
	<input
		id={noteId}
		name="note"
		value={asteroid.note ?? ''}
		maxlength="500"
		placeholder="A note, if it needs one"
	/>
	<button class="button button--ghost" type="submit">Save</button>
</form>

<p class="muted hint">
	Rewriting the title starts the drift again — a different rock is a different age. Amending the
	note leaves the clock where it is.
</p>

<div class="endings">
	<!--
		Available from the moment the rock exists, per decision #1, so it cannot
		claim the rock keeps coming back — on the first one that is simply untrue.
		The offer that has actually counted says so in its own words; this one
		only offers.
	-->
	<a class="tap promote" href="{newGoalHref}?asteroid={asteroid.id}">Make this a goal instead</a>

	<!--
		Spelled out, where there is room for the words. The row carries letting
		go as a mark once the rock has started to drift and not before, so this
		is both the only way to let a fresh one go and the place the mark is
		explained.
	-->
	<form method="POST" action={releaseAction}>
		<input type="hidden" name="id" value={asteroid.id} />
		<button class="tap let-go" type="submit">
			<span aria-hidden="true">↗</span>
			<!-- The title rides at the end so the visible sentence is not broken
			     across a hidden element, which leaves a gap where the clip box is. -->
			Release — let this one go<span class="visually-hidden"> ({asteroid.title})</span>
		</button>
	</form>
</div>

<style>
	.edit {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0.25rem 0 0;
	}

	/*
	 * Wide enough that the two of them only share a line where there is really
	 * room for both. In a sheet on a phone there is not, and a title field
	 * showing the last third of its own value is worse than a second line.
	 */
	.edit input {
		flex: 1 1 13rem;
		min-width: 0;
	}

	.edit .button {
		flex: none;
		font-size: var(--text-secondary);
		padding: 0.35rem 1rem;
	}

	.hint {
		font-size: var(--text-label);
		margin: 0.3rem 0 0;
		max-width: 60ch;
	}

	.endings {
		display: grid;
		justify-items: start;
	}

	.promote {
		color: var(--accent);
		display: inline-flex;
		font-size: var(--text-secondary);
		justify-content: flex-start;
	}

	/*
	 * Quiet, and not a `.button`: releasing is a legitimate ending and never
	 * the one being pushed.
	 */
	.let-go {
		background: none;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		gap: 0.4rem;
		justify-content: flex-start;
		padding: 0;
		text-align: left;
	}

	.let-go:hover {
		color: var(--text);
	}
</style>
