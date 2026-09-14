<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { focusTarget } from '$lib/focus';
	import { tick } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * Revoking removes the row the button was in, and it is the one row on this
	 * page a user is guaranteed to be standing on when it goes. Unenhanced the
	 * post reloads the page, focus restarts at the top of the document a long way
	 * back from where they were, and nothing says what happened — so the forms
	 * are enhanced, the live region below announces the count, and focus lands on
	 * the list the row left.
	 *
	 * The list rather than the next row: which row is "next" after a revoke is a
	 * guess, and the last row in the list has no next at all. The list is always
	 * there, it is named, and it is one Tab from whatever is to be done about the
	 * sessions that are left.
	 */
	let sessionList: HTMLUListElement | null = $state(null);

	const revoking: SubmitFunction = () => {
		return async ({ update }) => {
			await update();
			await tick();
			focusTarget(sessionList);
		};
	};

	const sessions = $derived(data.sessions);
	const others = $derived(sessions.filter((session) => !session.current).length);

	const stamp = $derived(
		new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: data.timeZone
		})
	);

	const day = $derived(
		new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: data.timeZone
		})
	);

	/** What the last action did, as one line for the live region. */
	const announcement = $derived.by(() => {
		if (form?.passwordChanged) {
			const revoked = form.revoked ?? 0;
			return revoked > 0
				? `Password changed. ${revoked} other ${revoked === 1 ? 'session was' : 'sessions were'} signed out.`
				: 'Password changed.';
		}
		if (form?.revoked === 0) return 'Those sessions had already ended.';
		if (form?.revoked) {
			return form.revoked === 1
				? 'One session has been signed out.'
				: `${form.revoked} sessions have been signed out.`;
		}
		return '';
	});
</script>

<svelte:head><title>Security · Nova</title></svelte:head>

<section class="security">
	<header class="head">
		<div>
			<h1>Security</h1>
			<p class="muted">
				Change your password and see everywhere Nova is signed in. Sessions last thirty days, so it
				is worth ending the ones you no longer recognise.
			</p>
		</div>
		<a class="button button--ghost" href={resolve('/settings')}>Flight settings</a>
	</header>

	<p class="live" role="status">{announcement}</p>

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

	<form class="panel form" method="POST" action="?/password">
		<h2>Password</h2>
		<p class="muted">
			Changing it signs out every other device, so anyone still holding the old password is locked
			out.
		</p>

		<div class="field">
			<label for="currentPassword">Current password</label>
			<input
				id="currentPassword"
				name="currentPassword"
				type="password"
				autocomplete="current-password"
				required
			/>
			{#if form?.errors?.currentPassword}<p class="error">{form.errors.currentPassword}</p>{/if}
		</div>

		<div class="field">
			<label for="newPassword">New password</label>
			<input
				id="newPassword"
				name="newPassword"
				type="password"
				autocomplete="new-password"
				minlength="8"
				required
			/>
			{#if form?.errors?.newPassword}<p class="error">{form.errors.newPassword}</p>{/if}
		</div>

		<div class="field">
			<label for="confirmPassword">New password again</label>
			<input
				id="confirmPassword"
				name="confirmPassword"
				type="password"
				autocomplete="new-password"
				minlength="8"
				required
			/>
			{#if form?.errors?.confirmPassword}<p class="error">{form.errors.confirmPassword}</p>{/if}
		</div>

		<button class="button" type="submit">Change password</button>
	</form>

	<div class="panel form">
		<h2>Active sessions</h2>
		<p class="muted">
			Each row is a browser holding a valid sign-in. Nova stores only a fingerprint of every
			session, never the key itself, so nothing here can be used to sign in.
		</p>

		<!-- `tabindex="-1"` so a revoke can hand focus to something that is still
		     on the page. Never in the tab order itself. -->
		<ul bind:this={sessionList} class="sessions" tabindex="-1" aria-label="Active sessions">
			{#each sessions as session (session.id)}
				<li class="session" class:session--current={session.current}>
					<div class="session__what">
						<span class="session__device">{session.device}</span>
						{#if session.current}<span class="badge">This device</span>{/if}
						<span class="muted session__when">
							Last used {stamp.format(session.lastSeenAt)} · started {day.format(session.createdAt)} ·
							expires {day.format(session.expiresAt)}
						</span>
					</div>

					{#if session.current}
						<form method="POST" action={resolve('/logout')}>
							<button class="button button--ghost" type="submit">
								Sign out <span class="visually-hidden">this device</span>
							</button>
						</form>
					{:else}
						<form method="POST" action="?/revoke" use:enhance={revoking}>
							<input type="hidden" name="id" value={session.id} />
							<button class="button button--danger" type="submit">
								Sign out <span class="visually-hidden">{session.device}</span>
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>

		{#if others > 0}
			<form method="POST" action="?/revokeOthers" use:enhance={revoking}>
				<button class="button button--danger" type="submit">
					Sign out all other sessions ({others})
				</button>
			</form>
		{/if}
	</div>
</section>

<style>
	.security {
		display: grid;
		gap: 1.25rem;
		max-width: 40rem;
	}

	.head {
		align-items: start;
		display: flex;
		gap: 1rem;
		justify-content: space-between;
	}

	.head div {
		display: grid;
		gap: 0.35rem;
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: 0.9rem;
	}

	.form {
		display: grid;
		gap: 1rem;
		padding: 1.5rem;
	}

	.form h2 {
		margin: 0;
	}

	/* Focused only as a recovery after a revoke; an outline round the whole list
	   would read as a selection rather than as a landing place. */
	.sessions:focus {
		outline: none;
	}

	.sessions {
		display: grid;
		gap: 0.75rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.session {
		align-items: center;
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: space-between;
		padding: 0.85rem 1rem;
	}

	.session--current {
		border-color: var(--space-border-bright);
	}

	.session__what {
		display: grid;
		gap: 0.2rem;
	}

	.session__device {
		color: var(--text-bright);
		font-weight: 600;
	}

	.session__when {
		font-size: 0.85rem;
	}

	.badge {
		background: rgba(167, 139, 250, 0.18);
		border-radius: var(--radius-sm);
		color: var(--accent);
		font-size: 0.75rem;
		justify-self: start;
		padding: 0.1rem 0.45rem;
	}

	@media (max-width: 34rem) {
		.head {
			flex-direction: column;
		}
	}
</style>
