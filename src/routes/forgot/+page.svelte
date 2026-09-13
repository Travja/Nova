<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Reset your password · Nova</title></svelte:head>

<section class="auth">
	<div class="auth__art"><Astronaut size={150} /></div>

	<form class="panel auth__form" method="POST">
		<h1>Lost your way back?</h1>

		{#if !data.configured}
			<p class="muted">
				This Nova instance has no mail server configured, so it cannot send a reset link. Whoever
				runs it can set a new password for you from the server.
			</p>
		{:else if form?.sent}
			<p class="sent" role="status">
				If that address has an account, a reset link is on its way. It works once and expires in
				half an hour.
			</p>
			<p class="muted">Nothing arrived? Check the spam folder before asking again.</p>
		{:else}
			<p class="muted">
				Give us the address you signed up with and we will send a link to choose a new password.
			</p>

			{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

			<div class="field">
				<label for="email">Email</label>
				<input id="email" name="email" type="email" autocomplete="email" required />
				{#if form?.errors?.email}<p class="error">{form.errors.email}</p>{/if}
			</div>

			<button class="button" type="submit">Send the link</button>
		{/if}

		<p class="muted">
			Remembered it? <a href={resolve('/login')}>Sign in</a>.
		</p>
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
