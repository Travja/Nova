<script lang="ts">
	import type { Goal } from '$domain/types';
	import { PALETTE, DEFAULT_COLOR } from '$domain/palette';
	import { eligibleParents, ORBIT_METRIC, type ParentCandidate } from '$domain/nesting';
	import { TIER_DEFINITIONS, TIER_LIST } from '$domain/tiers';
	import OrbitDial from '$components/OrbitDial.svelte';
	import { buildOrbit, formatAmount } from '$domain/progress';
	import { resolve } from '$app/paths';
	import { periodFor } from '$domain/period';
	import type { FormErrors } from '$domain/validation';

	interface Props {
		goal?: Goal | null;
		errors?: FormErrors | null;
		submitLabel?: string;
		/**
		 * Every live goal the pilot owns, so the parent picker can narrow itself
		 * as the tier changes without a round trip. It filters with
		 * `eligibleParents`, the same function the write path rejects with, so the
		 * picker cannot offer something the server will refuse.
		 */
		goals?: readonly ParentCandidate[];
		/** Goals already feeding this one, which is what makes it derived. */
		children?: readonly ParentCandidate[];
	}

	let {
		goal = null,
		errors = null,
		submitLabel = 'Launch goal',
		goals = [],
		children = []
	}: Props = $props();

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
	/* svelte-ignore state_referenced_locally */
	let parentId = $state(goal?.parentId ?? '');

	const tierDef = $derived(TIER_LIST.find((entry) => entry.id === tier) ?? TIER_LIST[1]);
	/**
	 * A goal with children counts closed child orbits rather than anything logged
	 * against it, so its target is a number of orbits and its own metric is the
	 * one it would go back to if its children ever left. The fields stay in the
	 * form as hidden values rather than disappearing from the row.
	 */
	const nested = $derived(children.length > 0);
	const previewMetric = $derived(nested ? ORBIT_METRIC : { kind: metricKind, unit: metricUnit });
	/** Recomputed as the tier changes: a Satellite can feed more than a Galaxy can. */
	const parents = $derived(eligibleParents({ id: goal?.id ?? null, tier }, goals));
	/** A parent that stops being eligible — the tier moved — is quietly dropped. */
	const parentChoice = $derived(
		parents.some((candidate) => candidate.id === parentId) ? parentId : ''
	);
	/**
	 * True when the goal being fed has nothing feeding it yet. Picking it turns it
	 * derived, which changes what its target means — from minutes or pages to a
	 * number of orbits — and that is worth saying before it happens rather than
	 * leaving a monthly goal quietly asking for 120 closed weeks.
	 */
	const parentIsNew = $derived(
		parentChoice !== '' && !goals.some((candidate) => candidate.parentId === parentChoice)
	);
	const parentTitle = $derived(
		parents.find((candidate) => candidate.id === parentChoice)?.title ?? ''
	);
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

		{#if nested}
			<!-- Nothing is logged against a goal with children, so it has no metric
			     to pick: its target is a count of the orbits underneath it. The
			     stored metric rides along hidden rather than being thrown away, so
			     the goal still has one the day its last child leaves. -->
			<div class="field">
				<label for="target">Target per orbit <span class="muted">(child orbits)</span></label>
				<input
					id="target"
					name="target"
					type="number"
					min="1"
					step="1"
					bind:value={target}
					required
				/>
				{#if errors?.target}<p class="error">{errors.target}</p>{/if}
				<p class="muted note">
					{children.length}
					{children.length === 1 ? 'goal feeds' : 'goals feed'} this one, so its orbit counts how many
					of their orbits closed. A child period that falls short counts nothing; one that overshoots
					counts once.
				</p>
			</div>
			<input type="hidden" name="metricKind" value={metricKind} />
			<input type="hidden" name="metricUnit" value={metricUnit} />
		{:else}
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
		{/if}

		<div class="field">
			<label for="parentId">Feeds <span class="muted">(optional)</span></label>
			<select id="parentId" name="parentId" bind:value={parentId}>
				<option value="">Nothing — this goal stands alone</option>
				{#each parents as candidate (candidate.id)}
					<option value={candidate.id}>
						{candidate.title} · {TIER_DEFINITIONS[candidate.tier].label}
					</option>
				{/each}
			</select>
			{#if errors?.parentId}<p class="error">{errors.parentId}</p>{/if}
			<p class="muted note">
				{#if parents.length === 0}
					Nothing to feed yet. A goal can only feed one on a longer cadence — a weekly Planet into a
					monthly Star System — so launch the bigger goal first.
				{:else}
					Every orbit this goal closes counts as one toward the goal it feeds. Close it twice over
					in a period and it still counts once.
				{/if}
			</p>
		</div>

		<fieldset class="field">
			<legend>Colour</legend>
			<div class="swatches">
				{#each PALETTE as swatch (swatch.value)}
					<label class="swatch" class:swatch--active={color === swatch.value} title={swatch.name}>
						<input type="radio" name="color" value={swatch.value} bind:group={color} />
						<span aria-hidden="true" style="background: {swatch.value}"></span>
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
			caption={formatAmount(Number(target) || 0, previewMetric)}
		/>
		<!-- The preview redraws on every keystroke in the form, and a live region
		     would narrate the lot. It is not one: the copy below is ordinary text,
		     read when the user reaches it. -->
		<p class="muted preview__copy">
			{#if nested}
				{title || 'This goal'} closes one orbit when
				<strong>{formatAmount(Number(target) || 0, previewMetric)}</strong>
				close underneath it in a {tierDef.cadence}.
			{:else}
				{title || 'This goal'} closes one orbit when you log
				<strong>{formatAmount(Number(target) || 0, previewMetric)}</strong>
				per {tierDef.cadence}.
			{/if}
			{#if parentTitle}
				Each one it closes feeds <strong>{parentTitle}</strong>.
				{#if parentIsNew}
					That makes {parentTitle} a derived goal — its orbit will count closed orbits rather than anything
					logged against it, so check its target once this one is saved.
				{/if}
			{/if}
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

	/* Sits under the control it explains, in the same column, so it reads as part
	   of the field rather than as copy the layout dropped there. */
	.note {
		font-size: var(--text-secondary);
		margin: 0.15rem 0 0;
	}

	.tiers {
		display: grid;
		gap: 0.5rem;
	}

	.tier-option {
		align-items: center;
		min-height: var(--tap-min);
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

	/*
	 * The radio itself is hidden and the label is the control you see, which is
	 * fine right up until somebody tabs into the group: the focus ring is drawn
	 * on a 1px transparent input nobody can find. Both radio groups here do it,
	 * so both forward the ring to the thing that is actually on screen.
	 *
	 * `:focus-visible` on the input rather than `:focus`, so a pointer click does
	 * not leave a ring behind — the same rule the rest of the app follows.
	 */
	.tier-option input {
		height: 1px;
		margin: 0;
		opacity: 0;
		position: absolute;
		width: 1px;
	}

	.tier-option:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
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

	.swatch:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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
