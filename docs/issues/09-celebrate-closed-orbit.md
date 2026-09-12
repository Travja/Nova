---
title: Celebrate a closed orbit
labels: [design, frontend]
milestone: 'M2 — The fun part'
---

Right now closing an orbit changes a line of text and thickens an arc. The single
best moment in the app passes almost unnoticed.

**Build a moment.** When a log closes an orbit:

- The arc completes with a sweep rather than a jump.
- A starburst or ignition at the point the body reaches.
- The astronaut reacts — a salute, a thumbs up, something brief.
- The streak counter ticks up with a small physical motion.

Keep it under a second, never block interaction, and skip it entirely under
`prefers-reduced-motion`, where a quiet state change is the celebration.

Scale it with the tier: a Satellite closing daily should be a small sparkle, a
Universe closing once a year should stop you in your tracks.

**Done when**

- Closing an orbit is unmistakable without being interruptive.
- The effect fires once per closing, not on every re-render or navigation.
