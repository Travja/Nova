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

`urgency()` in `src/lib/domain/progress.ts` is that weighting — the fraction of
the target still missing, multiplied by how far through its period the clock has
travelled. It stays a pure function so the ordering is unit-tested rather than
argued about in a template, and `periodElapsed()` reads each span off the period
itself, so a 23-hour daylight-saving day is measured against its own 23 hours. A
closed orbit scores zero, and so does a dormant one: a goal that spent the period
archived was never expected to fly, and must never surface as at risk.

The two bullets above are the whole actionable set, which means a long-period goal
that is behind but not near its deadline — the Universe goal at 10% in November —
does not make the risk list. It appears in a collapsed **Flying steady** group
instead, ranked by the same urgency, so the goal closest to becoming work sits at
the top of the ones that can wait. Surfacing it as at risk would need a
behind-pace threshold this spec does not name; that is a separate decision, not
an implementation detail.

Inline logging is the quick-log steps the goal cards already carry, posting to the
view's own `log` action. An arbitrary amount, a note or a backdated timestamp
still belongs to the goal page, which the row links to.

The narrow-screen landing is a client-side redirect from `/` on a fresh load
under 40rem. Arriving at `/` by link is a deliberate choice and is remembered for
the session, so the tiered dashboard stays put once picked. Both halves need a
browser: the dashboard is what the server renders and what anyone without
JavaScript keeps.

**Done when**

- `/today` lists only what is actionable, newest-risk first.
- Every row logs progress inline without navigating away.
- It is the default landing page on narrow screens; the tiered dashboard stays one
  tap away.
