---
title: 'Rest days: satellites that fly only on the days you choose'
labels: [enhancement, backend, frontend]
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

## Decided

Settled in the design session before any code. Each one took the
recommendation unless it says otherwise.

1. **Spans, not a column.** A `goal_schedules` table of
   `(goal_id, rest_days, from)`, where `rest_days` is a seven-bit mask with bit
   _d_ set for weekday _d_ (0 = Sunday, the numbering `zonedDayOfWeek` returns).
   No row means "flies every day", so every existing goal needs nothing. The
   service loads schedules beside `dormantWindows`; `restDayUnder()` in
   `$domain/schedule` picks the span in force at a period's start. A goal's
   first schedule starts at the start of the day it was launched; an edit
   starts at the start of tomorrow, so today and the past keep the schedule
   they were flown under. Editing twice in one day replaces tomorrow's pending
   span rather than stacking two.
2. **The user's zone at the period's start.** `zonedDayOfWeek(period.start,
timeZone)`. A period's start is local midnight, so this is the local weekday
   by construction. Tested across the `America/Denver` spring-forward Sunday
   (8 March 2026, a 23-hour day), and in `Pacific/Auckland`, where local
   midnight falls on the previous UTC day, so a UTC weekday would be wrong.
3. **Logging on a rest day is allowed, and it counts if it closes.** The orbit
   carries `rest` (a rest day under the schedule, and not archived), and
   `dormant` becomes `archived || (rest && !complete)`. A closed rest day is an
   ordinary closed orbit for the streak, lifetime orbits, stats and a parent's
   count. `streakFrom` already handled a closed orbit beside dormant ones; a
   test pins it. Because closing a rest day flips `dormant`, anything that
   rebuilds an orbit with a new amount (the offline overlay) goes through
   `relogOrbit()`, which keeps the reasons and recomputes the flag. Momentum is
   the one exception: it leaves every rest day out of its baseline, closed or
   not, so a flown rest day does not make ordinary days read as behind.
4. **Satellites only.** `restDayUnder()` answers false for any cadence but a
   day, and validation stores a zero mask for every other tier, so moving a
   goal off Satellite starts a "flies every day" span from tomorrow.
5. **At least one flying day.** Refused in `goalSchema`, with a message that
   points at archiving.
6. **Nesting warns, never blocks.** With decision 3, a target is never strictly
   unreachable — a child can always fly on its rest days — so the warning says
   the target needs rest days flown. `restDayCapacity()` in `$domain/nesting`
   counts how many orbits the children's current schedules allow in the
   parent's current period; the parent's edit form shows the warning when the
   target is above it. The derived maths does not change.
7. **Wording.** `orbitStanding()` says "rest day, no orbit expected" for an
   unclosed rest day, "orbit closed on a rest day, N% of target logged" for a
   closed one, and keeps the archived wording otherwise. Archived wins when a
   rest day falls inside an archive window, which is why `rest` is false there.
8. **Export and import: bump to format 2.** Bundles gain `goalSchedules`. An
   older Nova strips unknown keys, so an optional array would let it import a
   new file silently minus its schedules, turning every rest day into a missed
   one. Bumping makes it refuse with "update Nova" instead. This Nova reads
   format 1 and 2; a format 1 bundle has no schedules and imports as "flies
   every day". A test imports a fixed format-1 bundle.

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
