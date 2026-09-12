---
title: 'Today view: what needs attention right now'
labels: [enhancement, frontend]
milestone: 'M1 — Daily driver'
---

The dashboard groups goals by tier, which is the right mental model but the wrong
first screen on a phone. Most mornings the question is narrower: what is at risk
today?

**Build a focused view** that answers it:

- Satellites that have not closed today.
- Any goal whose period ends within 24 hours and is short of target.
- Goals already closed, collapsed out of the way rather than hidden — seeing them
  done is part of the reward.

Sort by urgency: how much is left, weighted by how little of the period remains.
A Universe goal at 10% in January is fine; the same goal at 10% in November is not.

**Done when**

- `/today` lists only what is actionable, newest-risk first.
- Every row logs progress inline without navigating away.
- It is the default landing page on narrow screens; the tiered dashboard stays one
  tap away.
