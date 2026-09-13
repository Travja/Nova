<script lang="ts">
	import type { Goal } from '$domain/types';
	import { PALETTE, DEFAULT_COLOR } from '$domain/palette';
	import { TIER_LIST } from '$domain/tiers';
	import OrbitDial from '$components/OrbitDial.svelte';
	import { buildOrbit, formatAmount } from '$domain/progress';
	import { resolve } from '$app/paths';
	import { periodFor } from '$domain/period';
	import type { FormErrors } from '$domain/validation';

	interface Props {
		goal?: Goal | null;
		errors?: FormErrors | null;
		submitLabel?: string;
	}

	let { goal = null, errors = null, submitLabel = 'Launch goal' }: Props = $props();

	// Form fields seed from the goal once; the props never change under this
	// component because each page renders a fresh instance.
	/* svelte-ignore state_referenced_locally */
	let title = $state(goal?.title ?? '');
	/* svelte-ignore state_referenced_locally */
	let tier = $state(goal?.tier ?? 'planet');
	/* svelte-ignore state_referenced_locally */
	let metricKind = $state(goal?.metric.kind ?? 'duration');
	/* svelte-ignore state_referenced_locally */
	let metricUnit = $state(goal?.metric.unit ?? '');
	/* svelte-ignore state_referenced_locally */
	let target = $state(goal?.target ?? 120);
	/* svelte-ignore state_referenced_locally */
	let color = $state(goal?.color ?? DEFAULT_COLOR);

	const tierDef = $derived(TIER_LIST.find((entry) => entry.id === tier) ?? TIER_LIST[1]);
	/** A live preview so the shape of the goal is visible before saving. */
	const previewOrbit = $derived(
		buildOrbit(
			periodFor(new Date(), tierDef.cadence, { timeZone: 'UTC' }),
			Number(target) * 0.45,
			Number(target) || 1
		)
	);
	const unitPlaceholder = $derived(metricKind === 'count' ? 'pages, workouts, chapters…' : '');
	const cancelHref = $derived(goal ? resolve('/goals/[id]', { id: goal.id }) : resolve('/'));
</script>

<div class="layout">
	<form class="panel form" method="POST">
		<div class="field">
			<label for="title">What is the goal?</label>
			<input id="title" name="title" bind:value={title} maxlength="80" required />
			{#if errors?.title}<p class="error">{errors.title}</p>{/if}
		</div>

		<div class="field">
			<label for="description">Notes <span class="muted">(optional)</span></label>
			<textarea id="description" name="description" maxlength="500"
				>{goal?.description ?? ''}</textarea
			>
		</div>

		<fieldset class="field">
			<legend>Tier</legend>
			<div class="tiers">
				{#each TIER_LIST as entry (entry.id)}
					<label class="tier-option" class:tier-option--active={tier === entry.id}>
						<input type="radio" name="tier" value={entry.id} bind:group={tier} />
						<span class="dot" style="background: {entry.accent}"></span>
						<span class="tier-option__label">{entry.label}</span>
						<span class="tier-option__blurb muted">{entry.blurb}</span>
					</label>
				{/each}
			</div>
			{#if errors?.tier}<p class="error">{errors.tier}</p>{/if}
		</fieldset>

		<div class="row">
			<div class="field">
				<label for="metricKind">Measured in</label>
				<select id="metricKind" name="metricKind" bind:value={metricKind}>
					<option value="duration">Time</option>
					<option value="count">A count</option>
					<option value="checkin">Check-ins</option>
				</select>
			</div>

			<div class="field">
				<label for="target">
					Target per orbit
					{#if metricKind === 'duration'}<span class="muted">(minutes)</span>{/if}
				</label>
				<input
					id="target"
					name="target"
					type="number"
					min="0.01"
					step="any"
					bind:value={target}
					required
				/>
				{#if errors?.target}<p class="error">{errors.target}</p>{/if}
			</div>
		</div>

		{#if metricKind === 'count'}
			<div class="field">
				<label for="metricUnit">Unit</label>
				<input
					id="metricUnit"
					name="metricUnit"
					bind:value={metricUnit}
					maxlength="24"
					placeholder={unitPlaceholder}
				/>
			</div>
		{:else}
			<input type="hidden" name="metricUnit" value={metricKind === 'duration' ? 'minutes' : ''} />
		{/if}

		<fieldset class="field">
			<legend>Colour</legend>
			<div class="swatches">
				{#each PALETTE as swatch (swatch.value)}
					<label class="swatch" class:swatch--active={color === swatch.value} title={swatch.name}>
						<input type="radio" name="color" value={swatch.value} bind:group={color} />
						<span style="background: {swatch.value}"></span>
						<span class="visually-hidden">{swatch.name}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		{#if errors?.form}<p class="error">{errors.form}</p>{/if}

		<div class="actions">
			<button class="button" type="submit">{submitLabel}</button>
			<a class="button button--ghost" href={cancelHref}>Cancel</a>
		</div>
	</form>

	<aside class="preview panel">
		<h2>Preview</h2>
		<OrbitDial
			orbit={previewOrbit}
			tier={tierDef.id}
			{color}
			size={170}
			caption={formatAmount(Number(target) || 0, { kind: metricKind, unit: metricUnit })}
		/>
		<p class="muted preview__copy">
			{title || 'This goal'} closes one orbit when you log
			<strong>{formatAmount(Number(target) || 0, { kind: metricKind, unit: metricUnit })}</strong>
			per {tierDef.cadence}.
		</p>
	</aside>
</div>

<style>
	.layout {
		display: grid;
		gap: 1.25rem;
		grid-template-columns: 1.3fr 0.7fr;
		align-items: start;
	}

	.form {
		display: grid;
		gap: 1.1rem;
		padding: 1.5rem;
	}

	fieldset {
		border: none;
		margin: 0;
		padding: 0;
	}

	legend {
		color: var(--text-dim);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		padding: 0 0 0.35rem;
		text-transform: uppercase;
	}

	.row {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr 1fr;
	}

	.tiers {
		display: grid;
		gap: 0.5rem;
	}

	.tier-option {
		align-items: center;
		background: rgba(6, 9, 26, 0.55);
		border: 1px solid var(--space-border);
		border-radius: var(--radius);
		cursor: pointer;
		display: grid;
		gap: 0 0.6rem;
		grid-template-columns: auto auto 1fr;
		padding: 0.6rem 0.85rem;
		transition: border-color 160ms ease;
	}

	.tier-option--active {
		border-color: var(--space-border-bright);
	}

	.tier-option input {
		height: 1px;
		margin: 0;
		opacity: 0;
		position: absolute;
		width: 1px;
	}

	.tier-option__label {
		color: var(--text-bright);
		font-weight: 620;
	}

	.tier-option__blurb {
		font-size: 0.85rem;
	}

	.dot {
		border-radius: 50%;
		height: 0.6rem;
		width: 0.6rem;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/*
	 * The dot stays 1.6rem; the target around it goes to the floor. Picking a
	 * colour is a one-off, but it is still a control, and seven of them in a row
	 * at 34px is the definition of having to aim.
	 */
	.swatch {
		border: 2px solid transparent;
		border-radius: 50%;
		cursor: pointer;
		display: grid;
		min-height: var(--tap-min);
		min-width: var(--tap-min);
		padding: 2px;
		place-items: center;
	}

	.swatch--active {
		border-color: var(--text-bright);
	}

	.swatch input {
		height: 1px;
		margin: 0;
		opacity: 0;
		position: absolute;
		width: 1px;
	}

	.swatch > span:first-of-type {
		border-radius: 50%;
		display: block;
		height: 1.6rem;
		width: 1.6rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.preview {
		display: grid;
		gap: 0.75rem;
		justify-items: center;
		padding: 1.5rem;
		position: sticky;
		text-align: center;
		top: 1rem;
	}

	.preview__copy {
		font-size: 0.9rem;
	}

	@media (max-width: 52rem) {
		.layout {
			grid-template-columns: 1fr;
		}

		.preview {
			order: -1;
			position: static;
		}

		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
