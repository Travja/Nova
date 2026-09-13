<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · Nova</title></svelte:head>

<section class="auth">
	<div class="auth__art"><Astronaut size={170} /></div>

	<form class="panel auth__form" method="POST">
		<h1>Welcome back</h1>
		<p class="muted">Your orbits are right where you left them.</p>

		{#if data.justReset}
			<p class="sent" role="status">
				Your password is set. Sign in with it — every other device was signed out.
			</p>
		{/if}

		{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

		<div class="field">
			<label for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				defaultValue={form?.email ?? ''}
			/>
			{#if form?.errors?.email}<p class="error">{form.errors.email}</p>{/if}
		</div>

		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
			/>
			{#if form?.errors?.password}<p class="error">{form.errors.password}</p>{/if}
		</div>

		<button class="button" type="submit">Sign in</button>
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
