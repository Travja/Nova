---
title: The starfield's nebulae are still sized in viewport units
labels: [bug, frontend]
milestone: 'M2 — The fun part'
---

Nova already learned this one. `QuickAdd` carries the note:

> Fixed to the viewport, and deliberately not measured in `vh`: those rebase when
> a mobile address bar hides mid-scroll, which is what sent the starfield's comet
> jumping. `env()` is the whole offset here.

The comet was fixed. The nebulae were not — `src/lib/components/Starfield.svelte`
still sizes and positions both blobs in `vmin`, which is `min(vw, vh)` and so
rebases on the same event:

```css
.nebula--violet {
	height: 60vmin;
	left: -10vmin;
	top: -8vmin;
	width: 60vmin;
	animation: breathe 26s ease-in-out infinite;
}
```

Positioned and animated, in a unit that changes size when a mobile address bar
hides. Every rule the comet broke.

## Why it has not been noticed

The blobs are `filter: blur(60px)` radial gradients at 0.3 and 0.14 alpha, with
no edge anywhere in them. A few pixels of rebase moves something that has no
discernible position, which is why this reads as fine on a phone while the comet
did not. It was left alone during #7 for exactly that reason: a visual change
with no accessibility gain, made in a file that change was not otherwise
touching.

So this is tidiness rather than a defect anyone can see — but it is the last
place the rule is broken, and leaving one exception is how the rule stops being
one. The next person to add a layer to the starfield will copy the block above.

## Build

- Size and position both nebulae in a unit that does not rebase. They are inside
  `.starfield`, which is `position: fixed; inset: 0`, so percentages of that box
  are the obvious swap and keep the "large, proportional to the screen" intent.
  `dvmin` is the other option if a viewport-relative size is genuinely wanted.
- Check the result at 390px wide and on a desktop window — the blobs are meant to
  bleed off two corners, and a percentage of a fixed box is not the same box the
  `vmin` was measuring.
- Leave `.starfield`'s own `inset: 0` alone; it is already correct.

While in the file: `layer` is `height: 130%; top: -15%` and already percentage
based, so the parallax layers need nothing.

## Done when

- No `vh`, `vw` or `vmin` anywhere in `Starfield.svelte`.
- The sky looks the same at 390px and at desktop width, in both starfield
  densities and with the starfield off.
- Scrolling a long page on a phone does not shift the nebulae when the address
  bar hides.
