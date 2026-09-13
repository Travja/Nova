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
- Any goal behind the pace its period calls for, however far off its deadline is.
  Half way through the year at 35% of a Universe goal needs attention in July, not
  in December.
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

A deadline is not the only way to be in trouble, so a row reaches the list by
either of two routes, and `FocusRow` records which: `isClosing()` for the period
running out, `isBehindPace()` for the standing falling behind. Everything else —
in flight, on pace, deadline out of sight — waits in a collapsed **Flying steady**
group, ranked by the same urgency so the goal closest to becoming work sits at
the top of the ones that can wait.

Pace is the share of the target the period's own clock calls for by now, minus
the share actually logged. Two guards keep it from crying wolf, both named
constants in `progress.ts`:

- `PACE_GRACE` (a third of the period) — nothing is judged before then, because
  Monday evening is not behind on a week.
- `PACE_TOLERANCE` (a tenth of the period) — slack allowed on top, because work
  arrives in bursts rather than at a constant rate.

A goal is never held to the part of a period that ran before it existed, so
`periodElapsed()` takes the later of the period's start and the goal's launch. A
Universe goal created in July is at the beginning of its first orbit, not half a
year behind on it.

A row whose period is closing says so in time left; a row that is only behind
pace says **Behind pace**, with the two numbers that make the case — how much is
done, and how much of the period is gone.

Inline logging is the quick-log steps the goal cards already carry, posting to the
view's own `log` action. An arbitrary amount, a note or a backdated timestamp
still belongs to the goal page, which the row links to.

The narrow-screen landing is a client-side redirect from `/` on a fresh load
under 40rem. Arriving at `/` by link is a deliberate choice and is remembered for
the session, so the tiered dashboard stays put once picked. Both halves need a
browser: the dashboard is what the server renders and what anyone without
JavaScript keeps.

**Done when**

- `/today` lists only what is actionable, newest-risk first, and says of each row
  whether time or pace put it there.
- Every row logs progress inline without navigating away.
- It is the default landing page on narrow screens; the tiered dashboard stays one
  tap away.
