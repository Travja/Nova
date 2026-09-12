<script lang="ts">
	import { resolve } from '$app/paths';
	import Rocket from '$components/Rocket.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	/** Resolved in the browser so periods line up with the user's own clock. */
	const timeZone =
		typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
</script>

<svelte:head><title>Create an account · Nova</title></svelte:head>

<section class="auth">
	<div class="auth__art"><Rocket size={120} launching /></div>

	<form class="panel auth__form" method="POST">
		<h1>Plot your first orbit</h1>
		<p class="muted">One account, every tier from satellite to universe.</p>

		{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

		<input type="hidden" name="timeZone" value={timeZone} />

		<div class="field">
			<label for="displayName">Name</label>
			<input
				id="displayName"
				name="displayName"
				required
				maxlength="64"
				value={form?.displayName ?? ''}
			/>
			{#if form?.errors?.displayName}<p class="error">{form.errors.displayName}</p>{/if}
		</div>

		<div class="field">
			<label for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={form?.email ?? ''}
			/>
			{#if form?.errors?.email}<p class="error">{form.errors.email}</p>{/if}
		</div>

		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength="8"
				required
			/>
			{#if form?.errors?.password}<p class="error">{form.errors.password}</p>{/if}
		</div>

		<div class="field">
			<label for="weekStartsOn">Weeks start on</label>
			<select id="weekStartsOn" name="weekStartsOn">
				<option value="1" selected>Monday</option>
				<option value="0">Sunday</option>
				<option value="6">Saturday</option>
			</select>
		</div>

		<button class="button" type="submit">Create account</button>
		<p class="muted">Already flying? <a href={resolve('/login')}>Sign in</a>.</p>
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

	@media (max-width: 48rem) {
		.auth {
			grid-template-columns: 1fr;
		}
	}
</style>
