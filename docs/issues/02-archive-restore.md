---
title: Archive and restore goals
labels: [enhancement, frontend]
milestone: 'M1 — Daily driver'
---

`goals.archivedAt` exists and the detail page can set it, but nothing reads it
back. An archived goal currently vanishes with no way to return it.

**Build**

- `/goals/archived` listing archived goals with their final orbit counts.
- Restore, which clears `archivedAt` and returns the goal to its tier.
- A confirmation on archive that says what happens: history is kept, the goal
  stops appearing on the dashboard, and streaks freeze rather than break.

`listGoals(userId, includeArchived)` already takes the flag.

**Done when**

- Archiving, viewing and restoring all work end to end.
- Archived goals are excluded from dashboard counts and the Today view.
- Restoring a goal does not retroactively break its streak.
