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

`goals.archivedAt` says whether a goal is archived now, which is not enough to
keep a streak honest once it is restored — the periods it slept through would
read as missed orbits. Each archive/restore cycle therefore records a span in
`goal_archive_windows`, and the streak maths steps over any orbit that falls
wholly inside one.

**Done when**

- Archiving, viewing and restoring all work end to end.
- Archived goals are excluded from dashboard counts and the Today view.
- Restoring a goal does not retroactively break its streak.
