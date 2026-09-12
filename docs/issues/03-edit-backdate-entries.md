---
title: Edit and backdate progress entries
labels: [enhancement, frontend]
milestone: 'M1 — Daily driver'
---

`entries.occurredAt` is stored separately from `createdAt` precisely so work can
be logged after the fact, and `logEntry()` accepts it — but no screen lets you
set it. Forgetting to log on Sunday should not cost the week.

**Build**

- A date and time control on the detail page's log form, defaulting to now.
- Editing an existing entry's amount, note and timestamp.
- Clear feedback when a backdated entry lands in a previous period: say which
  orbit it moved, since the current one will not change.

Validation lives in `entrySchema`. Reject timestamps in the future beyond a small
clock-skew allowance, and reject anything before the orbit the goal launched in —
the start of the period containing its `createdAt`, not the instant itself, so a
Planet goal added on Wednesday can still take Monday's work. Nothing may land in
an orbit that predates the goal.

The control sends wall-clock time with no zone attached, so parse it in the
user's own zone rather than the server's; `new Date(value)` would quietly file a
backdated entry under the wrong orbit.

**Done when**

- An entry can be created or moved into a past period and the right orbit updates.
- A backdated entry that closes a past orbit repairs the streak that was broken.
