<script lang="ts">
	import { onMount } from 'svelte';
	import {
		dismissRejected,
		flush,
		isDurable,
		isSyncing,
		queueAnnouncement,
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
	 * The queue's listeners are started here because this is the one component
	 * mounted on every page that has anything to do with the queue — it lives in
	 * the layout, and it comes down when the user signs out.
	 */

	const count = $derived(waiting());
	const refused = $derived(rejected());
	const syncing = $derived(isSyncing());
	const durable = $derived(isDurable());
	const announcement = $derived(queueAnnouncement());

	onMount(startQueue);
</script>

{#if count > 0 || refused.length > 0}
	<div class="queue-bar" class:queue-bar--refused={refused.length > 0}>
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
				<button class="queue-button tap" type="button" onclick={dismissRejected}>Dismiss</button>
			{:else}
				<button class="queue-button tap" type="button" onclick={() => flush()} disabled={syncing}>
					{syncing ? 'Syncing…' : 'Sync now'}
				</button>
			{/if}
		</div>
	</div>
{/if}

<p class="queue-live visually-hidden" role="status">{announcement}</p>

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

	.queue-button:disabled {
		color: var(--text-dim);
		cursor: progress;
	}
</style>
