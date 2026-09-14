<script lang="ts">
	import { dev } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import { focusMain, holdsFocus } from '$lib/focus';

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
	 *
	 * It appears without the user having asked for anything, so it has to be
	 * heard once and only once. The bar itself is not the live region — a region
	 * that arrives already full is a region browsers are free to say nothing
	 * about — so an empty `role="status"` is mounted from the first render and
	 * filled when the update lands. `needRefresh` only ever goes false→true, so
	 * the sentence is written once however many times the component re-renders.
	 */

	let needRefresh = $state(false);
	let dismissed = $state(false);
	let registration: ServiceWorkerRegistration | null = null;
	let bar: HTMLElement | null = $state(null);

	/** Empty until there is an update, then said once. */
	const announcement = $derived(
		needRefresh && !dismissed ? 'Nova has been updated. Reload to get the new version.' : ''
	);

	/** Dismissing removes the button that was dismissed; focus has to go on. */
	async function dismiss() {
		const held = holdsFocus(bar);
		dismissed = true;
		if (!held) return;
		await tick();
		focusMain();
	}

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

<!-- Mounted from the first render and empty until there is something to say,
     which is what makes the announcement land when it finally arrives. -->
<p class="visually-hidden" role="status">{announcement}</p>

{#if needRefresh && !dismissed}
	<div bind:this={bar} class="update-bar">
		<p>Nova has been updated — reload to get it.</p>
		<div class="actions">
			<button class="reload tap" type="button" onclick={reload}> Reload </button>
			<button class="dismiss tap" type="button" onclick={dismiss}>
				<span aria-hidden="true">✕</span>
				<span class="visually-hidden">Dismiss the update notice</span>
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
