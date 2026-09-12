<script lang="ts">
	import GoalForm from '$components/GoalForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Edit {data.goal.title} · Nova</title></svelte:head>

<header class="head">
	<h1>Adjust the orbit</h1>
	<p class="muted">
		Changing the tier or target reshapes past orbits too — history is recomputed from your entries.
	</p>
</header>

<GoalForm goal={data.goal} errors={form?.errors ?? null} submitLabel="Save changes" />

<style>
	.head {
		display: grid;
		gap: 0.35rem;
		padding-bottom: 1.25rem;
	}
</style>
