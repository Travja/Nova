---
title: Reorder goals on the dashboard
labels: [enhancement, frontend, good-first-issue]
milestone: 'M1 — Daily driver'
---

`goals.sortOrder` is populated on create and honoured when listing, but there is
no way to change it.

**Build** drag-to-reorder within a tier, persisted through a small form action
that takes an ordered list of goal ids.

Reordering is a mode rather than permanent chrome — a `?reorder=1` link swaps the
cards for a compact sortable list — so the dashboard stays about progress and the
mode survives a submit with no JavaScript.

Keep it usable without a pointer: move-up and move-down controls that work from a
keyboard and a screen reader, with the drag handle as an enhancement rather than
the only route. `sortable`-style libraries are usually overkill — the HTML drag
and drop API plus a `aria-live` announcement is enough for a list this size.

**Done when**

- Order survives a reload and applies to the dashboard and the Today view.
- Reordering is possible with keyboard alone.
