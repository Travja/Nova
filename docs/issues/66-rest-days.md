---
title: 'Rest days: satellites that fly only on the days you choose'
labels: [enhancement, backend, frontend, needs-design]
milestone: 'M5 — The long haul'
---

# 66 — Rest days

A Satellite counts every day. "Gym on weekdays" or "no screens on school nights"
breaks its streak every weekend, so the goal reports a failure every week for
sticking to the plan. Most habit trackers have a schedule; Nova has none.

The workaround is a Planet with a target of 5 check-ins. That models "five times
a week", which is a different goal: it loses the daily nudge, Today stops owing
it each morning, reminders stop, and it gets a planet body instead of a
satellite. Keep that workaround in mind, because it answers the "N times a week"
half of this request. The form's help text should point to it.

**This issue is about the other half:** a daily goal that flies on certain
weekdays and rests on the others.

## The hook: rest days are dormant orbits

Nova already has an orbit that nobody expected to fly. A period that falls
entirely inside an archive window is **dormant** (`isDormant()` in
`$domain/progress`). Every rule already treats dormant periods as transparent:

- `streakFrom()` skips them, so archiving freezes a streak rather than breaking it.
- `urgency()`, `isClosing()`, `paceDeficit()` and `isBehindPace()` return
  nothing for them.
- `focusForToday()` never marks a dormant satellite as owed today.
- `$domain/reminders` stays silent for them.
- `$domain/stats` leaves them out of completion rates.
- History and the dial draw them in the dormant style.

A rest day is a dormant day you planned in advance, rather than one that follows
from archiving. If `buildOrbit` marks rest days dormant, almost everything above
works without changes. What's left is where the schedule is stored, how it
changes over time, and the wording.

## Decisions for the design session

Each has a recommendation. The design session confirms or overturns them, writes
down the outcome, and adds tests, especially the DST test `CLAUDE.md` requires.

1. **Where it lives — recommend spans, not a column.** A plain `rest_days` mask
   on `goals` would apply a schedule change to the whole history. Marking past
   Saturdays as rest days would bring a broken streak back, and the orbit stops
   being honest. Store schedules the way archive windows are stored: a
   `goal_schedules` table of `(goal_id, rest_days mask, from)`. The service loads
   them alongside `dormantWindows`; the domain asks whether a period starts on a
   rest day under the schedule in force at its start. A change takes effect from
   the next day, never the current one or earlier.
2. **Which day of the week — recommend the user's zone at the period's start.**
   Use `zonedDayOfWeek(period.start, timeZone)`, the same zone rule as
   everything else. Test it around a DST transition in `America/Denver`.
3. **Logging on a rest day — recommend: allowed, and it counts if it closes.**
   A rest day you flew anyway should be a reward, not invisible. A rest day is
   dormant only if its orbit did **not** close. A closed one counts as an
   ordinary closed orbit: it adds to the streak, lifetime orbits and a parent's
   count. An unclosed one is transparent. Check that `streakFrom` handles a
   closed orbit next to dormant ones.
4. **Satellites only — recommend yes.** Rest weeks for planets or rest months
   for star systems are archiving by another name. Leave them out.
5. **At least one flying day — recommend required.** A schedule with all seven
   days off is archiving. Validate it in `$domain/validation`, with a message
   that suggests archiving.
6. **Nesting — recommend a warning, not a block.** A weekly parent fed by a
   five-day satellite can't reach a target of 7. When a child's schedule makes
   the parent's target unreachable, the parent form says so; it doesn't refuse
   to save. The derived maths itself doesn't change, because closed child orbits
   are still closed orbits.
7. **Wording.** `orbitStanding()` currently says "archived for this period, no
   orbit expected" for every dormant orbit. Rest days need their own phrase, such
   as "rest day, no orbit expected". So the orbit, or the snapshot, has to carry
   why it is dormant, and not just that it is.
8. **Export and import.** Schedules go into the bundle like archive windows. A
   bundle without them imports as "flies every day". Decide whether that means
   bumping `TRANSFER_SCHEMA_VERSION` or adding an optional array with a
   default, and test that an existing v1 bundle still imports.

## The form

On a Satellite only: seven weekday toggles, all on by default, in the user's
week-start order. Under them, a line of help: "Want N times a week rather than
certain days? Make it a Planet with a target of N."

The goal detail page shows the schedule. The history strip already draws
dormant days; check that rest days are clearly distinct from missed days.

## Not in scope

- Any skip or grace mechanic, such as one missed day forgiven. That is a
  separate and debatable idea.
- Rest days on any tier other than Satellite.
- One-off rest days, such as a holiday. Archiving the goal for those days
  already does that.

## Done when

- A Satellite can rest on chosen weekdays.
- A rest day that doesn't close neither breaks nor extends the streak, isn't owed
  on Today, sends no reminder and isn't counted in stats. One that closes counts.
- Changing the schedule never changes the past. A unit test brings back an old
  week under the old schedule after the schedule has changed.
- A DST test with a real `America/Denver` date covers the weekday rule.
- Export and import carry schedules, and an existing bundle still imports.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass, with a journey that
  sets weekday rest days and checks Saturday on Today.
