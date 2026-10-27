---
title: 'Goals that end: challenges and seasons that finish instead of being archived'
labels: [enhancement, backend, frontend, needs-design]
milestone: 'M5 — The long haul'
---

# 67 — Goals that end

Some goals are meant to stop: a 30-day challenge, a 12-week training block, a
semester of reading, a sober October. Today the only way to stop a goal is to
archive it. Archiving means "paused": the periods become dormant, the streak
freezes, the goal waits in `/goals/archived` to be restored, and nothing marks
that it was **finished**. Finishing a 30-day challenge should feel like landing,
not like putting something on a shelf.

## The idea

A goal can have an end. After its last period, it is **finished**:

- It leaves the dashboard, Today, the universe and reminders, as an archived goal
  does.
- It never becomes dormant, and its record is final: orbits closed out of the
  periods it flew, its best streak, the streak it ended on.
- It has a place to be seen afterwards, with that record. Archived goals don't
  show one.
- Finishing is a moment. When a finished goal is next seen, or its last orbit
  closes, it gets a closing card, reusing the #9 celebration shapes. It doesn't
  need a new animation system.

## Decided

Settled in the design session. Each took the recommendation unless it says
otherwise; the code lives in `$domain/ending` unless it names somewhere else.

1. **The end instant is stored.** `goals.ends_at`, nullable, UTC ms: the
   exclusive `end` of the last period the goal flies, computed by
   `endInstant()` when the goal is saved, from a last day read in the user's
   zone. The form offers "after 30 days", "after 12 weeks", "at the end of this
   quarter" and "on a date"; every one of them becomes a last day and then a
   period end, so a weekly goal ending on a Wednesday flies that whole week. If
   the user's zone changes later the instant stays put: the goal finishes at the
   same moment, and its last orbit is whichever period in the new zone holds the
   instant before it. `ending.test.ts` pins both, across a DST transition.
2. **Finished is its own state, and it is time, not an action.** `goalStatus()`
   reads `ends_at <= now` as finished before it reads `archived_at`, so a goal
   whose end passes while it is archived **finishes at once** — no job has to
   notice, and the hangar never offers to restore a goal that could not fly. A
   finished goal cannot be archived. An archived goal can still be given an end.
3. **Extending is allowed and brings the goal back.** Moving the end past now
   makes it fly again; the periods between the old end and now are ordinary
   periods with nothing in them — missed, not dormant. Extending a goal that
   finished while archived also restores it, closing its archive window at the
   old end so the gap still reads as missed. A new end can't land before the
   current period ends; leaving a finished goal's end alone is always allowed.
4. **Nesting: ending a parent asks about its children.** A finished child's
   entries and closures stop at its end, so it stops feeding from the period
   after; the parent's past counts stand. Saving an end on a parent asks
   whether its children end with it (each on the end of its own period that
   holds the parent's last instant) or carry on, detached as on delete. A
   detached child's closures leave the parent's record with it, which the form
   says. A live goal can't be given a finished parent (`parentProblem` →
   `finished`), `eligibleParents` never offers one, and `universeTree` drops
   finished snapshots before it builds anything, so neither ever sees a
   finished goal as a parent of something flying.
5. **They share `/goals/archived`, renamed the Hangar.** Two sections,
   Finished then Archived: the mental model is "goals that aren't flying". The
   route keeps its path so nothing that links to it breaks.
6. **Stats count what was flown.** `loadStatsInputs()` includes finished goals,
   each snapshotted at its last instant with history sized to the periods it
   flew, so completion never counts a period after the end. A finished goal's
   last orbit is settled: it is over, so it gets no in-flight benefit of the
   doubt. Momentum and the logging rhythm stay live goals only — they are
   about the pace now.
7. **`endsAt` travels in the bundle.** `goalBundleSchema.endsAt` is nullable
   and defaults to null, so a bundle exported before this imports unchanged;
   the schema version stays 1. An imported goal that would fly under a
   finished parent is detached, the same rule as at write time.

**The moment** reuses #9 whole. A last orbit that closes raises the ordinary
celebration with `final` set, and the copy says it was the last one. A finished
goal's page shows its final record in a closing card and, the first time this
browser sees it finished, raises the same burst on its dial.

## Not in scope

- A start date in the future, such as a challenge that begins next Monday.
  Goals start when they are created, and that stays as it is. File it separately
  if it's wanted.
- Repeating seasons, such as "every October".

## Done when

- A goal can be given an end when it's created or edited, using the presets or a
  date.
- After its last period it leaves every active surface. It shows a final record
  and gets a closing moment.
- Extending a finished goal brings it back, and counts the gap as missed.
- Finishing a parent handles its children as decided. Neither the universe tree
  nor the nesting maths sees a finished parent.
- The end survives export and import, and an existing bundle still imports.
- Unit tests cover the end instant across a time-zone change and a DST
  transition. A journey covers a goal reaching its end with a pinned clock.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass.
