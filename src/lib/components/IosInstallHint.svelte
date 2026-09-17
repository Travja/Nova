<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { focusMain, holdsFocus } from '$lib/focus';
	import { isIosSafari, isStandalone } from '$lib/platform';

	/**
	 * iOS fires no `beforeinstallprompt`, so the only way anyone finds "Add to
	 * Home Screen" is being told about it. Shown only in mobile Safari, and only
	 * while running in a browser tab — never Android, never desktop, never
	 * inside the installed app itself, where the standalone check below already
	 * says no.
	 *
	 * The check is UA and `matchMedia`, both unavailable during SSR, so this
	 * starts hidden and only ever reveals itself after mount. That costs a
	 * one-frame delay, not a hydration mismatch.
	 *
	 * Informative, not decorative: it is the only route to installing Nova on
	 * iOS, so it announces itself the same way `UpdatePrompt` does — an empty
	 * `role="status"` mounted up front and filled once, rather than a region that
	 * arrives already full and may say nothing at all.
	 */

	let show = $state(false);
	let dismissed = $state(false);
	let hint: HTMLElement | null = $state(null);

	const announcement = $derived(
		show && !dismissed ? 'Nova can be installed: tap Share, then Add to Home Screen.' : ''
	);

	async function dismiss() {
		const held = holdsFocus(hint);
		dismissed = true;
		if (!held) return;
		await tick();
		focusMain();
	}

	onMount(() => {
		// The same two questions the reminder opt-in asks, from the same place:
		// iOS delivers push only to an installed PWA, so "can this install" and
		// "can this be reminded" have to agree about what installed looks like.
		show = isIosSafari() && !isStandalone();
	});
</script>

<p class="visually-hidden" role="status">{announcement}</p>

{#if show && !dismissed}
	<div bind:this={hint} class="ios-hint">
		<p>Install Nova: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>
		<button class="dismiss tap" type="button" onclick={dismiss}>
			<span aria-hidden="true">✕</span>
			<span class="visually-hidden">Dismiss the install hint</span>
		</button>
	</div>
{/if}

<style>
	/*
	 * In flow rather than fixed, like `UpdatePrompt` — see there for why. Both
	 * can be on screen together (an iOS user with an update waiting), and
	 * neither has to know about the other when nothing is pinned to an edge.
	 */
	.ios-hint {
		align-items: center;
		background: var(--space-surface-strong);
		border: 1px solid var(--space-border-bright);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lift);
		display: flex;
		gap: 0.5rem 1rem;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		padding: 0.6rem 0.9rem;
	}

	.ios-hint p {
		color: var(--text-bright);
		font-size: var(--text-secondary);
	}

	.dismiss {
		background: transparent;
		border: 1px solid var(--space-border);
		border-radius: 50%;
		color: var(--text-dim);
		cursor: pointer;
		flex-shrink: 0;
		font: inherit;
		padding: 0;
	}

	.dismiss:hover {
		border-color: var(--space-border-bright);
		color: var(--text-bright);
	}
</style>
