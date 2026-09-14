<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { TIER_DEFINITIONS } from '$domain/tiers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Editable, and shared across every goal's form below via a hidden input. */
	/* svelte-ignore state_referenced_locally */
	let note = $state(data.sharedText);
	const logAction = `${resolve('/share')}?/log`;
</script>

<svelte:head>
	<title>Share to Nova · Nova</title>
</svelte:head>

<section class="share">
	<header>
		<h1>Log a shared note</h1>
		<p class="muted">Pick a goal and Nova logs an entry against it with this note.</p>
	</header>

	{#if form?.errors?.form}<p class="error">{form.errors.form}</p>{/if}
	<p class="live" role="status">
		{#if form?.logged}Logged.{/if}
	</p>

	<div class="field">
		<label for="note">Note</label>
		<textarea id="note" bind:value={note} maxlength="200"></textarea>
	</div>

	{#if data.goals.length === 0}
		<p class="empty muted">
			Nothing in orbit yet. <a href={resolve('/goals/new')}>Launch a goal</a> first.
		</p>
	{:else}
		<ul class="goals">
			{#each data.goals as goal (goal.id)}
				<li>
					<form method="POST" action={logAction} use:enhance>
						<input type="hidden" name="goalId" value={goal.id} />
						<input type="hidden" name="note" value={note} />
						<input type="hidden" name="amount" value="1" />
						<button class="goal panel tap" type="submit">
							<span class="pill" style="color: {TIER_DEFINITIONS[goal.tier].accent}">
								{TIER_DEFINITIONS[goal.tier].label}
							</span>
							<span class="title">{goal.title}</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.share {
		display: grid;
		gap: var(--gap-view);
	}

	.live:empty {
		display: none;
	}

	.live {
		color: var(--success);
		font-size: var(--text-secondary);
		margin: -0.9rem 0 0;
	}

	.empty {
		max-width: 60ch;
	}

	.goals {
		display: grid;
		gap: var(--gap-list);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.goals li form {
		display: contents;
	}

	.goal {
		align-items: center;
		background: none;
		border: 1px solid var(--space-border);
		color: var(--text);
		cursor: pointer;
		display: flex;
		font: inherit;
		gap: 0.6rem;
		padding: var(--pad-card);
		text-align: left;
		width: 100%;
	}

	.goal:hover {
		border-color: var(--space-border-bright);
	}

	.pill {
		border: 1px solid currentColor;
		border-radius: 999px;
		flex-shrink: 0;
		font-size: var(--text-label);
		font-weight: 640;
		letter-spacing: 0.08em;
		padding: 0.15rem 0.55rem;
		text-transform: uppercase;
	}

	.title {
		color: var(--text-bright);
		font-weight: 600;
	}
</style>
