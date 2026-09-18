<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Asteroid } from '$domain/asteroids';

	/**
	 * Everything a one-off can be, other than looked at: rename it, give it a
	 * note, finish it, send it into orbit, or let it go.
	 *
	 * The row itself carries no buttons — its endings are a swipe — so this is
	 * where they are reachable by a tap, a keyboard, a screen reader and a
	 * browser running no script at all. A gesture is an enhancement and never
	 * the only way through a door.
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
		clearAction: string;
		editAction: string;
		releaseAction: string;
		/** Keeps the field ids apart when the row and the sheet both render. */
		idPrefix?: string;
	}

	let { asteroid, clearAction, editAction, releaseAction, idPrefix = '' }: Props = $props();

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
		The three ways out, spelled out where there is room for the words. Two of
		them are a swipe on the row and one is only ever here; all three are a tap
		from this list, which is what keeps the gesture an enhancement.

		The title rides at the end of each name so the visible sentence is not
		broken across a hidden element, which leaves a gap where the clip box is.
	-->
	<form method="POST" action={clearAction}>
		<input type="hidden" name="id" value={asteroid.id} />
		<button class="tap ending ending--done" type="submit">
			<span aria-hidden="true">✓</span>
			Done — finish this one<span class="visually-hidden"> ({asteroid.title})</span>
		</button>
	</form>

	<form method="POST" action={releaseAction}>
		<input type="hidden" name="id" value={asteroid.id} />
		<button class="tap ending" type="submit">
			<span aria-hidden="true">↗</span>
			Release — let this one go<span class="visually-hidden"> ({asteroid.title})</span>
		</button>
	</form>

	<!--
		Available from the moment the rock exists, per decision #1, so it cannot
		claim the rock keeps coming back — on the first one that is simply untrue.
		The offer that has actually counted says so in its own words; this one
		only offers.
	-->
	<a class="tap promote" href="{newGoalHref}?asteroid={asteroid.id}">Make this a goal instead</a>
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
	 * Quiet, and none of them a `.button`: the belt is the band you reach for
	 * when nothing is due, and the three endings are on equal footing — nothing
	 * here is being pushed, least of all letting go.
	 */
	.ending {
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

	.ending:hover {
		color: var(--text);
	}

	/* Finishing is the likelier of the three, so it is the one that is lit. */
	.ending--done {
		color: var(--text);
	}

	.ending--done:hover {
		color: var(--success);
	}
</style>
