<script lang="ts">
	import { useRegisterSW } from 'virtual:pwa-register/svelte';

	/**
	 * Tells the user a new build is waiting rather than swapping it in under
	 * them. `registerType: 'prompt'` (vite.config.ts) leaves the new service
	 * worker in `waiting` until `updateServiceWorker()` sends it the skip; in
	 * dev the virtual module is a stub whose `needRefresh` store never flips,
	 * so this renders nothing there — no service worker, no prompt.
	 */

	const { needRefresh, updateServiceWorker } = useRegisterSW();

	// Lives as long as the layout that mounts this once, so a dismissal
	// survives client-side navigation instead of reappearing on the next route.
	let dismissed = $state(false);
</script>

{#if $needRefresh && !dismissed}
	<div class="update-bar" role="status">
		<p>Nova has been updated — reload to get it.</p>
		<div class="actions">
			<button class="reload tap" type="button" onclick={() => updateServiceWorker(true)}>
				Reload
			</button>
			<button class="dismiss tap" type="button" onclick={() => (dismissed = true)}>
				<span aria-hidden="true">✕</span>
				<span class="visually-hidden">Dismiss</span>
			</button>
		</div>
	</div>
{/if}

<style>
	/*
	 * In the document's own flow rather than fixed over it, so it pushes the
	 * masthead down instead of floating above content — nothing to keep clear
	 * of the FAB in the corner or the last row of whatever list is on screen,
	 * both of which this would otherwise have to reason about.
	 */
	.update-bar {
		align-items: center;
		background: var(--space-surface-strong);
		border: 1px solid var(--space-border-bright);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lift);
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		padding: 0.6rem 0.9rem;
	}

	.update-bar p {
		color: var(--text-bright);
		font-size: var(--text-secondary);
		font-weight: 560;
	}

	.actions {
		align-items: center;
		display: flex;
		gap: 0.5rem;
	}

	.reload {
		background: linear-gradient(140deg, #7c5cf0, #a78bfa);
		border: 1px solid transparent;
		border-radius: 999px;
		color: #0b0a1f;
		cursor: pointer;
		font: inherit;
		font-weight: 620;
		padding: 0.35rem 0.9rem;
	}

	.dismiss {
		background: transparent;
		border: 1px solid var(--space-border);
		border-radius: 50%;
		color: var(--text-dim);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.dismiss:hover {
		border-color: var(--space-border-bright);
		color: var(--text-bright);
	}
</style>
