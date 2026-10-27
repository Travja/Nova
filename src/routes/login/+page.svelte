<script lang="ts">
	import { applyAction } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Astronaut from '$components/Astronaut.svelte';
	import FieldError from '$components/FieldError.svelte';
	import { describedBy } from '$domain/validation';
	import { actionUrl, postAction } from '$lib/passkeys';
	import {
		browserSupportsWebAuthn,
		browserSupportsWebAuthnAutofill,
		startAuthentication,
		WebAuthnAbortService,
		type PublicKeyCredentialRequestOptionsJSON
	} from '@simplewebauthn/browser';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Where the password form posts: its action, keeping `?next=`. */
	const passwordAction = $derived(actionUrl('password', page.url));

	/** Known only once mounted; the server cannot tell what this browser supports. */
	let supported = $state(false);
	let busy = $state(false);
	/** A failure from the browser's side, before the server saw anything. */
	let problem = $state('');

	async function challenge(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
		const result = await postAction('passkeyOptions');
		if (result.type !== 'success' || !result.data?.passkeyOptions) {
			await applyAction(result);
			return null;
		}
		return result.data.passkeyOptions as PublicKeyCredentialRequestOptionsJSON;
	}

	async function finish(response: unknown) {
		await applyAction(await postAction('passkey', { response: JSON.stringify(response) }));
	}

	/**
	 * The button. Cancelling the browser's prompt is not an error worth more
	 * than a line — the password form is right there.
	 */
	async function signInWithPasskey() {
		if (busy) return;
		busy = true;
		problem = '';
		try {
			const optionsJSON = await challenge();
			if (!optionsJSON) return;
			let response;
			try {
				response = await startAuthentication({ optionsJSON });
			} catch {
				problem = 'No passkey was used. Try again, or sign in with your password.';
				return;
			}
			await finish(response);
		} finally {
			busy = false;
		}
	}

	/**
	 * Conditional mediation: browsers that can offer passkeys from the email
	 * field's autofill get a ceremony waiting for that, started quietly on
	 * mount. The button cancels it if pressed first.
	 */
	async function offerFromAutofill() {
		if (!(await browserSupportsWebAuthnAutofill())) return;
		const optionsJSON = await challenge();
		if (!optionsJSON) return;
		let response;
		try {
			response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
		} catch {
			// Aborted by the button, or nothing was picked. Either way, quiet.
			return;
		}
		await finish(response);
	}

	onMount(() => {
		if (!data.passkeys || !browserSupportsWebAuthn()) return;
		supported = true;
		void offerFromAutofill();
		return () => WebAuthnAbortService.cancelCeremony();
	});
</script>

<svelte:head><title>Sign in · Nova</title></svelte:head>

<section class="auth">
	<div class="auth__art"><Astronaut size={170} /></div>

	<form class="panel auth__form" method="POST" action={passwordAction}>
		<h1>Welcome back</h1>
		<p class="muted">Your orbits are right where you left them.</p>

		{#if data.justReset}
			<p class="sent" role="status">
				Your password is set. Sign in with it — every other device was signed out.
			</p>
		{/if}

		{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}
		{#if problem}<p class="error">{problem}</p>{/if}

		<div class="field">
			<label for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="username webauthn"
				required
				defaultValue={form?.email ?? ''}
				{...describedBy(form?.errors?.email, 'email')}
			/>
			<FieldError id="email" message={form?.errors?.email} />
		</div>

		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				{...describedBy(form?.errors?.password, 'password')}
			/>
			<FieldError id="password" message={form?.errors?.password} />
		</div>

		<button class="button" type="submit">Sign in</button>
		{#if supported}
			<button
				class="button button--ghost"
				type="button"
				disabled={busy}
				onclick={signInWithPasskey}
			>
				Sign in with a passkey
			</button>
		{/if}
		{#if data.canReset}
			<p class="muted"><a href={resolve('/forgot')}>Forgotten your password?</a></p>
		{/if}
		<p class="muted">No account yet? <a href={resolve('/register')}>Start flying</a>.</p>
	</form>
</section>

<style>
	.auth {
		align-items: center;
		display: grid;
		gap: 2rem;
		grid-template-columns: 0.8fr 1fr;
		padding: 1.5rem 0 3rem;
	}

	.auth__art {
		display: grid;
		justify-items: center;
	}

	.auth__form {
		display: grid;
		gap: 1rem;
		padding: 1.75rem;
	}

	.sent {
		color: var(--success);
	}

	@media (max-width: 48rem) {
		.auth {
			grid-template-columns: 1fr;
		}
	}
</style>
