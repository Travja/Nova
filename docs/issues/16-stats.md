---
title: 'Stats: best streak, completion rate, momentum'
labels: [enhancement]
milestone: 'M3 — Insight'
---

`snapshotGoal()` computes the current streak, total closed orbits and lifetime
total. Several more numbers are cheap to derive from the same buckets and are the
ones people actually want:

- Best streak ever, not just the current one.
- Completion rate per tier — are Satellites carrying everything while Galaxies
  quietly rot?
- Momentum: this period's pace against the same point in previous periods.
- Time of day and day of week you actually log, which is often a surprise.

Add them as pure functions beside `snapshotGoal()` with unit tests, then surface
them on a summary page. Resist turning this into a dashboard of vanity metrics —
each number should suggest an action.

**Done when**

- Each statistic has a test with a hand-checked fixture.
- The summary page explains what each number means in a sentence.
