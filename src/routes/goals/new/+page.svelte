<script lang="ts">
	import GoalForm from '$components/GoalForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * The same screen, with the rock's own words already in it. A one-off that
	 * kept coming back knows its title and whatever note it collected; the tier,
	 * the metric and the target are the things it never had, which is exactly
	 * what turning it into a goal decides.
	 */
	const capturing = $derived(data.asteroid);
</script>

<svelte:head>
	<title>{capturing ? 'Capture into orbit' : 'New goal'} · Nova</title>
</svelte:head>

<header class="head">
	<h1>{capturing ? 'Capture into orbit' : 'Launch a goal'}</h1>
	<p class="muted">
		{#if capturing}
			<strong>{capturing.title}</strong> leaves the belt and becomes a goal. Pick the orbit it belongs
			in, then say what one revolution takes.
		{:else}
			Pick the orbit it belongs in, then say what one revolution takes.
		{/if}
	</p>
</header>

<GoalForm
	goals={data.goals}
	errors={form?.errors ?? null}
	seed={capturing ? { title: capturing.title, description: capturing.note } : null}
	submitLabel={capturing ? 'Capture into orbit' : 'Launch goal'}
	cancelTo={capturing ? '/today' : null}
/>

<style>
	.head {
		display: grid;
		gap: 0.35rem;
		padding-bottom: 1.25rem;
	}
</style>
