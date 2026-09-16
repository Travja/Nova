<script lang="ts">
	import { resolve } from '$app/paths';
	import Astronaut from '$components/Astronaut.svelte';
	import FieldError from '$components/FieldError.svelte';
	import { describedBy } from '$domain/validation';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Choose a new password · Nova</title>
	<!-- The token is in this page's URL; no Referer carries it anywhere. -->
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<section class="auth">
	<div class="auth__art"><Astronaut size={150} /></div>

	<form class="panel auth__form" method="POST">
		<h1>Choose a new password</h1>

		{#if !data.usable}
			<p class="error">That link has expired or has already been used.</p>
			<p class="muted">
				Links last half an hour and work once. <a href={resolve('/forgot')}>Ask for a new one</a>.
			</p>
		{:else}
			<p class="muted">
				Setting a new password signs out every device, including whoever asked for this link.
			</p>

			{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}

			<input type="hidden" name="token" value={data.token} />

			<div class="field">
				<label for="password">New password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					{...describedBy(form?.errors?.password, 'password')}
				/>
				<FieldError id="password" message={form?.errors?.password} />
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
					{...describedBy(form?.errors?.confirmPassword, 'confirmPassword')}
				/>
				<FieldError id="confirmPassword" message={form?.errors?.confirmPassword} />
			</div>

			<button class="button" type="submit">Set the password</button>
		{/if}
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
