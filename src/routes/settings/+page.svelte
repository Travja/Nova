<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { PREFERENCE_KEYS, specFor } from '$domain/preferences';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Offer the browser's own zone alongside whatever is stored. */
	const detected =
		typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
	const zones = $derived([...new Set([data.profile.timeZone, detected, 'UTC'])]);

	/**
	 * `app.html` is a static file, so `<html>`'s preference attributes only come
	 * from the server on a real navigation. A save here goes through `enhance`
	 * instead — no navigation happens at all — so once the account's new values
	 * are confirmed saved, stamp them on `<html>` by hand. That is what makes a
	 * preference apply immediately rather than on the next page load.
	 */
	const submitPreferences: SubmitFunction = ({ formData }) => {
		return async ({ result, update }) => {
			if (result.type === 'success') {
				for (const key of PREFERENCE_KEYS) {
					const value = formData.get(key);
					if (typeof value === 'string') {
						document.documentElement.setAttribute(specFor(key).attribute, value);
					}
				}
			}
			await update();
		};
	};
</script>

<svelte:head><title>Settings · Nova</title></svelte:head>

<section class="settings">
	<header class="head">
		<h1>Flight settings</h1>
		<p class="muted">
			Nova draws period boundaries in your own time zone, so keep this accurate and weeks will start
			where you expect.
		</p>
	</header>

	<form class="panel form" method="POST" use:enhance={submitPreferences}>
		{#if form?.saved}<p class="saved">Saved.</p>{/if}

		<div class="field">
			<label for="displayName">Name</label>
			<input
				id="displayName"
				name="displayName"
				defaultValue={data.profile.displayName}
				maxlength="64"
				required
			/>
			{#if form?.errors?.displayName}<p class="error">{form.errors.displayName}</p>{/if}
		</div>

		<div class="field">
			<label for="timeZone">Time zone</label>
			<select id="timeZone" name="timeZone">
				{#each zones as zone (zone)}
					<option value={zone} selected={zone === data.profile.timeZone}>{zone}</option>
				{/each}
			</select>
			{#if form?.errors?.timeZone}<p class="error">{form.errors.timeZone}</p>{/if}
		</div>

		<div class="field">
			<label for="weekStartsOn">Weeks start on</label>
			<select id="weekStartsOn" name="weekStartsOn">
				<option value="1" selected={data.profile.weekStartsOn === 1}>Monday</option>
				<option value="0" selected={data.profile.weekStartsOn === 0}>Sunday</option>
				<option value="6" selected={data.profile.weekStartsOn === 6}>Saturday</option>
			</select>
		</div>

		<!-- Driven off the preference table, so #14's motion and palette settings
		     appear here the moment they are declared. -->
		{#each PREFERENCE_KEYS as key (key)}
			{@const spec = specFor(key)}
			<div class="field">
				<label for={key}>{spec.label}</label>
				<select id={key} name={key}>
					{#each spec.values as value (value)}
						<option {value} selected={value === data.profile.preferences[key]}>
							{spec.options[value]}
						</option>
					{/each}
				</select>
				{#if spec.hint}<p class="muted hint">{spec.hint}</p>{/if}
			</div>
		{/each}

		<button class="button" type="submit">Save</button>
	</form>

	<p class="muted">
		Looking for your password or the devices you are signed in on?
		<a href={resolve('/settings/security')}>Security settings</a>.
	</p>
</section>

<style>
	.settings {
		display: grid;
		gap: var(--gap-view);
		max-width: 34rem;
	}

	.head {
		display: grid;
		gap: 0.35rem;
	}

	.form {
		display: grid;
		gap: 1rem;
		padding: var(--pad-panel);
	}

	.saved {
		color: var(--success);
		font-size: var(--text-secondary);
	}

	.hint {
		font-size: var(--text-secondary);
	}
</style>
