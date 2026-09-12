<script lang="ts">
	import GoalForm from '$components/GoalForm.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>New goal · Nova</title></svelte:head>

<header class="head">
	<h1>Launch a goal</h1>
	<p class="muted">Pick the orbit it belongs in, then say what one revolution takes.</p>
</header>

<GoalForm errors={form?.errors ?? null} />

<style>
	.head {
		display: grid;
		gap: 0.35rem;
		padding-bottom: 1.25rem;
	}
</style>
