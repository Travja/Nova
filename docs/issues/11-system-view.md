---
title: 'Solar-system view: every goal in one sky'
labels: [design, frontend, needs-design]
milestone: 'M2 — The fun part'
---

The dashboard is a grid of separate dials. The metaphor promises something better:
one system, with your goals as bodies at their true relative scales — satellites
whipping around, a universe barely moving.

**Explore** a single canvas where:

- Each goal orbits at a radius set by its tier and an angle set by its progress.
- Tapping a body opens its detail.
- The whole thing is readable on a 390px-wide screen, which is the hard part.

This may not survive contact with more than a dozen goals, so treat it as an
alternate view rather than a replacement, with a toggle that is remembered.

**Open questions**

- How do two goals at identical progress in the same tier avoid overlapping?
- Does the system animate continuously, or only on entry?
- What happens with forty goals?

Worth a prototype before committing.
