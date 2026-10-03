---
title: Roll up closed orbits instead of replaying every entry
labels: [performance, backend]
milestone: 'M4 — Reach and operations'
---

> **Closed as not planned.** At personal scale the replay is fast enough, and a
> rollup is a second source of truth with its own invalidation rules. If the
> dashboard or the universe view ever gets slow, benchmark first — a few years of
> synthetic entries across ~40 goals, timing `listGoalSnapshots()` and
> `universeTree()` — and build this only if the numbers ask for it.

`listGoalSnapshots()` loads every entry for every goal on each dashboard render,
because lifetime orbit counts are derived from the full history. That is correct
and it is fine at thousands of entries. It is wrong at a million, and a daily goal
kept for five years is a few thousand rows on its own.

**Approach**

- A rollup table keyed by goal and period: total logged, whether it closed.
- Written when an entry is logged, edited or deleted, inside the same transaction.
- Closed periods are immutable once their period has passed, apart from backdated
  edits, which must invalidate and recompute exactly the affected period.
- Keep the pure functions as the source of truth and have the rollup be a cache
  that can be rebuilt from entries with a single command.

**Done when**

- The dashboard query no longer scales with lifetime entry count.
- A rebuild command reproduces the rollups exactly from raw entries.
- Backdating an entry updates the affected period and nothing else.
