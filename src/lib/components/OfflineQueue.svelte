<script lang="ts">
	import { onMount } from 'svelte';
	import { focusMain } from '$lib/focus';
	import {
		dismissRejected,
		flush,
		isDurable,
		isSyncing,
		queueAnnouncement,
		queueAnnouncementStamp,
		rejected,
		startQueue,
		waiting
	} from '$lib/offline/queue.svelte';

	/**
	 * What the offline queue says for itself.
	 *
	 * Two jobs, and the second is the one #7 will come looking for. The bar is
	 * the visible state — how many entries are waiting, and a way to ask again
	 * without waiting for a browser event. The live region beneath it is the
	 * same state for anybody not looking at it: queued, synced, refused. A
	 * pending entry that is only a tint on a card is a pending entry a screen
	 * reader never hears about.
	 *
	 * `role="status"` rather than `aria-live="assertive"`: none of this should
	 * interrupt what is being read, and all of it can wait for a pause.
	 *
	 * Two things a live region gets wrong if they are left alone, and both are
	 * handled below. It only speaks when its contents change, so two identical
	 * announcements in a row — "1 entry synced." on a connection dropping in and
	 * out — would be one announcement; the region is emptied and refilled off
	 * `queueAnnouncementStamp()` so the second is heard. And the region has to be
	 * in the document before the change, which is why it is mounted
	 * unconditionally rather than appearing with the bar.
	 *
	 * The queue's listeners are started here because this is the one component
	 * mounted on every page that has anything to do with the queue — it lives in
	 * the layout, and it comes down when the user signs out.
	 */

	const count = $derived(waiting());
	const refused = $derived(rejected());
	const syncing = $derived(isSyncing());
	const durable = $derived(isDurable());
	const showBar = $derived(count > 0 || refused.length > 0);

	onMount(startQueue);

	/**
	 * The live region's own copy of the announcement, emptied for a beat before
	 * it is refilled. Without the gap a repeat of the same sentence is a no-op to
	 * the region and silence to whoever was waiting to hear it.
	 */
	let spoken = $state('');

	$effect(() => {
		// Tracked so a repeat of the same words still re-runs this.
		queueAnnouncementStamp();
		const next = queueAnnouncement();
		spoken = '';
		const timer = setTimeout(() => (spoken = next), 60);
		return () => clearTimeout(timer);
	});

	/**
	 * The bar can empty under the user's own hands.
	 *
	 * Pressing "Sync now" is the obvious way — the button empties the queue and
	 * the queue is the only reason the bar is on screen — but a background flush
	 * landing while the button merely has focus does exactly the same thing, and
	 * no handler would ever hear about that one. So this watches the bar rather
	 * than the actions: whoever is standing in it when it goes is carried to the
	 * start of the main content instead of being dropped on `<body>`.
	 */
	let bar: HTMLElement | null = $state(null);

	/**
	 * Whether focus is inside the bar. A plain variable rather than `$state`: the
	 * effect below tracks the bar's existence, and making this reactive would
	 * have it re-run on its own write.
	 */
	let held = false;

	/**
	 * Watched on the document rather than on the bar, which sounds indirect and
	 * is the only version that works.
	 *
	 * `focusin` on the bar says when focus arrives, but its `focusout` fires
	 * during the removal as well as when the user simply tabs away, and clearing
	 * the flag there loses the one case worth recovering. Focus moving to
	 * `<body>` — which is what a removal leaves behind — fires no `focusin` at
	 * all, so a document-level listener sees every deliberate move away and none
	 * of the accidental ones.
	 */
	onMount(() => {
		const onFocusIn = (event: FocusEvent) => {
			held = Boolean(bar?.contains(event.target as Node));
		};
		document.addEventListener('focusin', onFocusIn);
		return () => document.removeEventListener('focusin', onFocusIn);
	});

	$effect(() => {
		if (showBar || !held) return;
		held = false;
		focusMain();
	});
</script>

{#if showBar}
	<div bind:this={bar} class="queue-bar" class:queue-bar--refused={refused.length > 0}>
		<p>
			{#if refused.length > 0}
				{refused.length}
				{refused.length === 1 ? 'entry' : 'entries'} could not be synced.
				<span class="muted">{refused[0].reason}</span>
			{:else}
				{count}
				{count === 1 ? 'entry' : 'entries'} logged offline, waiting to sync.
				{#if !durable}
					<span class="muted">This browser will not keep them if you reload.</span>
				{/if}
			{/if}
		</p>

		<div class="actions">
			{#if refused.length > 0}
				<button class="queue-button tap" type="button" onclick={dismissRejected}> Dismiss </button>
			{:else}
				<!-- `aria-disabled` rather than `disabled`: a button that disables
				     itself the instant it is pressed hands focus straight back to
				     `<body>`, which is the thing this component is trying not to do.
				     Busy, still focused, and ignoring a second press. -->
				<button
					class="queue-button tap"
					type="button"
					aria-disabled={syncing}
					onclick={() => !syncing && flush()}
				>
					{syncing ? 'Syncing…' : 'Sync now'}
				</button>
			{/if}
		</div>
	</div>
{/if}

<p class="queue-live visually-hidden" role="status">{spoken}</p>

<style>
	/*
	 * In the flow above the masthead, exactly like the update prompt and for the
	 * same reason: floating it would have to reason about the quick-add button
	 * in the corner and the last row of whatever list is on screen.
	 */
	.queue-bar {
		align-items: center;
		background: var(--space-surface-strong);
		border: 1px solid var(--space-border-bright);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lift);
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap-block) var(--gap-card);
		justify-content: space-between;
		margin-bottom: var(--gap-block);
		padding: var(--pad-card);
	}

	.queue-bar--refused {
		border-color: var(--danger);
	}

	.queue-bar p {
		color: var(--text-bright);
		font-size: var(--text-secondary);
		font-weight: 560;
		margin: 0;
	}

	.actions {
		align-items: center;
		display: flex;
		gap: var(--gap-block);
	}

	/* A control, so it takes the 44px floor from `.tap` in every density. */
	.queue-button {
		background: transparent;
		border: 1px solid var(--space-border-bright);
		border-radius: 999px;
		color: var(--text-bright);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-secondary);
		padding: 0 0.9rem;
	}

	.queue-button:hover {
		border-color: var(--accent);
	}

	.queue-button[aria-disabled='true'] {
		color: var(--text-dim);
		cursor: progress;
	}
</style>
