---
title: Orbit history and a heatmap
labels: [enhancement, frontend]
milestone: 'M3 — Insight'
---

The detail page shows the last twelve orbits as small rings. That is enough to see
a streak and not enough to see a pattern.

**Build a history page** per goal:

- A calendar heatmap of logged amounts, at the granularity of the goal's tier.
- The full orbit list with each one's total, target and whether it closed.
- Paging back through the goal's whole life, not just twelve periods.

`recentPeriods()` already walks backwards from any instant, so the data side is
mostly assembling a range rather than new maths.

**Dormant spans are not misses.** Archiving a goal records a dormant window, and
`Orbit` carries a `dormant` flag for periods that fall inside one. A blank cell
would read as a failure for time the goal was deliberately asleep, so give
dormant periods their own treatment — hatched, greyed, or dropped from the grid
with a marker — and say which in the legend.

**Done when**

- A year of daily entries renders without jank.
- Hovering or tapping a cell shows the entries behind it.
- A span the goal spent archived cannot be mistaken for a run of misses.
