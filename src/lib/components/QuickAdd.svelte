<script lang="ts">
	import { resolve } from '$app/paths';
	import Rocket from '$components/Rocket.svelte';

	/**
	 * The primary action, put where a thumb can reach it.
	 *
	 * Creating a goal used to live in the masthead, in a row of four items that
	 * wrapped on a phone and sat at the top of the screen — the part of a phone a
	 * thumb reaches last. On a narrow screen this replaces that nav item rather
	 * than duplicating it; above 40rem the header has room and a floating control
	 * would look out of place, so this is the one that goes away.
	 *
	 * Nova's own rocket rather than an icon font: the project draws in CSS and
	 * inline SVG only, and this is the mark the app already launches goals under
	 * — the empty states call it `Launch a goal`. Small and round, so it sits on
	 * top of a list without burying much of it.
	 *
	 * A link, not a button: it navigates, so it belongs in the focus order with a
	 * real name. The rocket is `aria-hidden`, so the name is carried by text that
	 * is there for a screen reader rather than left to the glyph.
	 *
	 * #30 asks whether this should grow into a menu once asteroids land. It does
	 * not need to decide that to exist, and a menu would turn a one-tap action
	 * into two, so it stays one tap until #30 is designed.
	 */
</script>

<a class="quick-add" href={resolve('/goals/new')}>
	<Rocket size={26} />
	<span class="visually-hidden">New goal</span>
</a>

<style>
	.quick-add {
		align-items: center;
		background: linear-gradient(140deg, #7c5cf0, #a78bfa);
		border-radius: 50%;
		/*
		 * Fixed to the viewport, and deliberately not measured in `vh`: those
		 * rebase when a mobile address bar hides mid-scroll, which is what sent
		 * the starfield's comet jumping. `env()` is the whole offset here.
		 *
		 * The inset keeps it off the home indicator on an iPhone. `body` carries
		 * the same insets as padding, but a fixed element is positioned against
		 * the viewport rather than that padding, so it has to ask again.
		 */
		bottom: calc(1rem + env(safe-area-inset-bottom));
		box-shadow:
			0 10px 30px -10px rgba(0, 0, 0, 0.9),
			0 0 22px -8px var(--accent);
		display: flex;
		height: var(--fab-size);
		justify-content: center;
		position: fixed;
		right: calc(1rem + env(safe-area-inset-right));
		transition:
			transform 140ms ease,
			filter 140ms ease;
		width: var(--fab-size);
		/* Above the panels, below nothing — there is no dialog in the app yet. */
		z-index: 20;
	}

	.quick-add:hover {
		filter: brightness(1.08);
		text-decoration: none;
	}

	.quick-add:active {
		transform: translateY(1px);
	}

	/*
	 * A `<dialog>` puts itself in the top layer, so a fixed element does not
	 * float above it — it shows through the backdrop instead, dimmed and dead.
	 * While a sheet is up, this is not the action on offer.
	 */
	:global(body:has(dialog[open])) .quick-add {
		display: none;
	}

	/* Above this the masthead carries the action instead; see `+layout.svelte`,
	   which hides its own nav item below the same width. */
	@media (min-width: 40.0625rem) {
		.quick-add {
			display: none;
		}
	}
</style>
