---
title: 'Nested orbits: let small goals feed a bigger one'
labels: [enhancement]
milestone: 'M2 — The fun part'
---

The tier ladder is a nesting metaphor — a satellite orbits a planet, a planet
orbits a star — but the tiers are independent today. Making the nesting real is
the most interesting mechanic available.

**The idea.** A goal can declare a parent in a higher tier. Progress flows upward:
four closed weekly Planet orbits close the monthly Star System orbit above them.
"Exercise 3× a week" feeds a monthly goal without logging anything twice.

## Decision: a parent counts closed child orbits

Settled. The alternative was summing the child's raw amounts, and the difference
is what each one measures: **summing measures volume, counting closed orbits
measures consistency.**

Under summing, a parent is largely redundant. Eight hours in one week and nothing
for three looks identical to two hours every week, and the same number is already
readable from the child's own history. Under counting, the parent expresses
something the child cannot: _how many weeks did I actually hit it this month._
Nova's whole premise is consistency, so that is the one that earns the feature.

**Under-counting is the point, not a cost.** It runs in both directions and both
are deliberate:

- A child period that does not close contributes **nothing**. Two of three
  workouts in a week is zero toward the month.
- A child period that overshoots contributes **exactly one**. Nine workouts in a
  week where the target is three is one closed orbit, not three.

A parent therefore cannot be gamed by cramming, and cannot be rescued by a heroic
final week. That is the behaviour we want from a consistency measure. Do not
"fix" either direction later without revisiting this section.

## The rest of the rules

- **A parent's target is a count of closed child orbits**, not a quantity in the
  child's metric. "Close 4 weekly orbits this month."
- **A goal with children is derived.** It cannot also be logged against directly.
  Mixing manual entries with derived closures makes "what closed this orbit"
  unanswerable, and leaves the parent's unit ambiguous. If you want to log to a
  goal directly, do not give it children.
- **A parent counts its direct children only**, not the whole subtree. Nesting
  composes without anyone having to reason about grandchildren.
- **A child's cadence must be strictly shorter than its parent's**, following the
  tier ladder. Enforce it in validation, not just in the picker.
- **Attribute a closed child orbit to the parent period containing the child
  period's end.** A week spanning a month boundary counts toward the month it
  finished in. This is the edge case most likely to be got wrong silently — test
  it explicitly.
- **A dormant child period contributes nothing and breaks nothing.** The archive
  windows from #2 already produce `Orbit.dormant`; reuse it rather than inventing
  a second notion of "asleep".
- **Changing a child's target reshapes history**, because orbits are computed from
  entries at read time. That is already true of every goal today and the edit
  screen already says so. No special handling.

## Data model

- `goals.parent_id TEXT REFERENCES goals(id) ON DELETE SET NULL` — orphan the
  children rather than cascading them away with a deleted parent.
- Validation: the parent must belong to the same user, its cadence must be
  strictly longer, and the graph must stay acyclic. Reject a cycle rather than
  detecting it at read time.
- `snapshotGoal()` is unchanged for a leaf. The tree resolution belongs beside it
  in `$domain`, as a pure function over already-loaded children — the service in
  `src/lib/server/goals.ts` loads the shape, the domain layer does the maths.

## The visual payoff

A child body orbiting its parent on the dial, which is the thing the metaphor has
been promising since the scaffold. Worth doing properly rather than as a label.

## Deliberately deferred

- Logging directly against a parent that has children.
- Aggregating beyond direct children.
- A per-child contribution mode. One mode is simpler, and it is the mode that
  makes the tier ladder mean something.

## As built

The rules above are unchanged. Four things the implementation had to decide that
the spec did not say, recorded here because each one is load-bearing:

- **A closed child orbit is attributed by the child period's _last instant_, not
  by `period.end`.** `end` is exclusive, so a week finishing on the last day of
  October has an `end` of 1 November and reading it directly files that week
  under the wrong month. Nothing fails when this is wrong; the orbit is just
  quietly one out. `parentPeriodFor()` in `$domain/nesting` is the one place it
  is decided, and `nesting.test.ts` pins it at `America/Denver` around 1
  November 2026 — a Sunday, and the day daylight saving ends — from both sides.
- **The cadence rule is enforced from above as well as below.** A child
  declaring a parent is the obvious direction; a parent moving _down_ the ladder
  while goals already feed it breaks the same rule from the other end, so
  `tierProblem()` refuses that in the same write.
- **A derived goal is measured in orbits**, whatever metric its row carries from
  before it had children. `metricFor(snapshot)` is the only place that decides,
  and the stored metric is kept rather than overwritten so the goal still has one
  the day its last child leaves.
- **What the offline queue closes reaches the goals counting it.** A child that
  closes its own orbit while the phone has no signal moves the parent's dial too,
  through `overlayAll` in `$domain/queue` — otherwise two dials on the same
  screen disagree about the same fact. Same `parentPeriodFor` the server counted
  with.

## Done when

- A goal can declare a parent of a strictly longer cadence, and cannot declare a
  cycle, a same-cadence parent, or another user's goal.
- A parent's orbit closes exactly when its target number of direct child orbits
  have closed within its period.
- A child orbit that overshoots counts once; a child period that falls short
  counts zero; a dormant child period counts zero without breaking the streak.
- A child week ending inside a month counts toward that month, with a test at a
  real boundary.
- Deleting a parent leaves its children intact and unparented.
