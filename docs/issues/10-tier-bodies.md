---
title: Give each tier its own body
labels: [design, frontend]
milestone: 'M2 — The fun part'
---

Every tier currently draws the same circle in a different colour, with a ring
added for the larger three. The tiers are the core metaphor and should be
recognisable at a glance, from across a room, without reading the label.

**Design a body per tier**, all as inline SVG:

- **Satellite** — a small cratered moon, or a blinking comsat with panels.
- **Planet** — a banded world, subtly rotating.
- **Star System** — a star with its own small worlds.
- **Galaxy** — a spiral, slowly turning.
- **Universe** — something that reads as vast: a field of distant light.

Constraints that keep this from bloating: no animation library, no raster assets,
legible at 24px in the history strip and at 230px on the detail page, and honest
under reduced motion.

**Read `OrbitDial.svelte` before trusting this spec's layout.** It has changed
since this was written: the progress caption now sits below the orbit rather than
inside it, and the ring stops short to make room. Anything here describing where
things sit on the dial is a description of the old one.

`Orbit` also carries a `dormant` flag now, for periods the goal spent archived.
Decide what each body does while dormant — dimmed, unlit, still — rather than
letting it render as an ordinary empty orbit.

**Done when**

- Each tier is identifiable without its label.
- The same component renders correctly at every size currently in use.
- A dormant orbit is visibly distinct from one that was simply missed.
