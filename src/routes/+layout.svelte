<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import IosInstallHint from '$components/IosInstallHint.svelte';
	import OfflineQueue from '$components/OfflineQueue.svelte';
	import QuickAdd from '$components/QuickAdd.svelte';
	import Rocket from '$components/Rocket.svelte';
	import Starfield from '$components/Starfield.svelte';
	import UpdatePrompt from '$components/UpdatePrompt.svelte';
	import { MAIN_ID } from '$lib/focus';
	import '$lib/styles/app.css';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const onAuthPage = $derived(['/login', '/register'].includes(page.url.pathname));
	/** Everywhere but the page it would navigate to. */
	const showQuickAdd = $derived(Boolean(data.user) && page.url.pathname !== resolve('/goals/new'));

	onMount(() => {
		// Marks the point where the forms below become interactive: until Svelte
		// takes over, typing into a bound field is undone by hydration. Styling
		// and the end-to-end tests both need to know when that has happened.
		document.documentElement.dataset.hydrated = 'true';
	});
</script>

<svelte:head>
	<meta name="theme-color" content="#0b0f2a" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</svelte:head>

<Starfield />

<div class="shell">
	<UpdatePrompt />
	<!-- Signed out there is nothing to sync, and nothing that could be: an
	     entry belongs to an account. -->
	{#if data.user}
		<OfflineQueue />
	{/if}
	<IosInstallHint />

	<header class="masthead">
		<a class="brand" href={resolve('/')}>
			<Rocket size={30} />
			<span>Nova</span>
		</a>

		<nav>
			{#if data.user}
				<a class="nav-link tap" href={resolve('/today')}>Today</a>
				<a class="nav-link nav-link--wide tap" href={resolve('/goals/new')}>New goal</a>
				<a class="nav-link tap" href={resolve('/settings')}>{data.user.displayName}</a>
				<form method="POST" action={resolve('/logout')}>
					<button class="nav-link nav-link--button tap" type="submit">Sign out</button>
				</form>
			{:else if !onAuthPage}
				<a class="nav-link tap" href={resolve('/login')}>Sign in</a>
				<a class="button" href={resolve('/register')}>Start flying</a>
			{/if}
		</nav>
	</header>

	<!--
		In the flow right after the nav it replaces on a narrow screen, rather than
		at the very end of the document. It is `position: fixed` either way, so
		this changes nothing about where it is drawn and everything about where it
		is reached: the primary action arriving after the footer is not "somewhere
		sensible" for the one control a phone user is most likely to want.
	-->
	{#if showQuickAdd}
		<QuickAdd />
	{/if}

	<!--
		`tabindex="-1"` makes this scriptable focus, never tabbable focus: it is
		where `$lib/focus` sends the user when the control they were standing on
		is taken off the screen. The three bars above are the ones that do that,
		and `<main>` is forward of all of them, so tabbing on from here carries
		them into the page rather than back out through the masthead.
	-->
	<main id={MAIN_ID} tabindex="-1">
		{@render children()}
	</main>

	<footer class="footer muted">
		<span>Nova — track goals as orbits.</span>
	</footer>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		margin: 0 auto;
		max-width: 68rem;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 1rem;
	}

	/*
	 * Room for the floating button to sit over, so it never buries the last row
	 * of whatever list is on screen — Today, the dashboard and the archive all
	 * end in one. Taken on the shell rather than on each of those, so the footer
	 * clears it too and the next list does not have to remember.
	 *
	 * Its footprint, not a guess: the control's own height plus the gap it keeps
	 * from the bottom, twice over so the last row clears rather than just meets
	 * it, plus the home indicator.
	 */
	@media (max-width: 40rem) {
		.shell {
			padding-bottom: calc(var(--fab-size) + 2rem + env(safe-area-inset-bottom));
		}

		.nav-link--wide {
			display: none;
		}
	}

	.masthead {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		justify-content: space-between;
		padding: 0 0 0.75rem;
	}

	.brand {
		align-items: center;
		color: var(--text-bright);
		display: inline-flex;
		font-size: 1.25rem;
		font-weight: 700;
		gap: 0.6rem;
		letter-spacing: 0.02em;
	}

	.brand:hover {
		text-decoration: none;
	}

	nav {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	nav form {
		display: contents;
	}

	/* Nav items are controls, so they take the touch floor. `.tap` supplies it;
	   the masthead's own padding came down to pay for the taller row. */
	.nav-link {
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 560;
	}

	.nav-link--button {
		background: none;
		border: none;
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.nav-link:hover {
		color: var(--text-bright);
		text-decoration: none;
	}

	main {
		flex: 1;
	}

	/* Focus lands here only as a recovery, and outlining the entire page would
	   say something much louder than "carry on from here". The screen reader
	   still announces the landmark; a sighted keyboard user sees the next Tab
	   pick up inside the content, which is the whole point. */
	main:focus {
		outline: none;
	}

	.footer {
		font-size: var(--text-secondary);
		padding: 2rem 0 0.5rem;
		text-align: center;
	}
</style>
