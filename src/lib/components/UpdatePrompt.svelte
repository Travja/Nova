<script lang="ts">
	import { dev } from '$app/environment';
	import { onMount } from 'svelte';

	/**
	 * Tells the user a new build is waiting rather than swapping it in under
	 * them. `registerType: 'prompt'` (vite.config.ts) leaves a newly installed
	 * service worker in `registration.waiting` rather than activating it, so
	 * this only has to notice that and, on accept, tell it to skip waiting.
	 *
	 * `virtual:pwa-register/svelte` would normally do this registration and
	 * watching, but its production build imports `workbox-window`, a package
	 * only `vite-plugin-pwa` itself depends on — pnpm's strict linking does
	 * not expose it to this project's own bundling, so building with that
	 * import fails outright (confirmed against CI, not just guessed). This is
	 * the fallback the issue names for exactly that case: register by hand
	 * and watch `waiting` and `updatefound` directly.
	 */

	let needRefresh = $state(false);
	let dismissed = $state(false);
	let registration: ServiceWorkerRegistration | null = null;

	function watch(reg: ServiceWorkerRegistration) {
		registration = reg;
		if (reg.waiting) needRefresh = true;

		reg.addEventListener('updatefound', () => {
			const installing = reg.installing;
			installing?.addEventListener('statechange', () => {
				// "installed" with an existing controller is an update sitting
				// behind the page already open; the very first install of all has
				// no controller yet and nothing to prompt about.
				if (installing.state === 'installed' && navigator.serviceWorker.controller) {
					needRefresh = true;
				}
			});
		});
	}

	onMount(() => {
		if (dev || !('serviceWorker' in navigator)) return;

		let reloaded = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (reloaded) return;
			reloaded = true;
			window.location.reload();
		});

		navigator.serviceWorker
			.register('/sw.js', { updateViaCache: 'none' })
			.then(watch)
			.catch(() => {
				// An unavailable worker only costs offline support; the app still runs.
			});
	});

	function reload() {
		registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
	}
</script>

{#if needRefresh && !dismissed}
	<div class="update-bar" role="status">
		<p>Nova has been updated — reload to get it.</p>
		<div class="actions">
			<button class="reload tap" type="button" onclick={reload}> Reload </button>
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
