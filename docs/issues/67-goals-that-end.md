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

## Decisions for the design session

Each has a recommendation; the design session confirms or overturns them and
writes the outcome here.

1. **What is stored — recommend the end instant.** Store
   `goals.ends_at`, nullable, in UTC ms: the `end` of the last period the goal
   flies, computed when the goal is saved, in the user's zone. That follows
   "nothing stores a local time". The form takes a date and presets ("30 days",
   "12 weeks", "end of this quarter"), and the service turns it into a period
   end. Say in the spec what happens if the user's zone changes later: the
   instant stays fixed. Test it.
2. **Finished and archived are separate states — recommend yes.** A finished
   goal can't be archived; an archived goal can still have an end. If its end
   passes while it is archived, it finishes when restored, or at once? Decide,
   and test it.
3. **Extending — recommend allowed.** Moving the end later brings a finished goal
   back. The periods between the old end and now are **missed**, not dormant.
   Its time away is part of the record, as it would be for any goal left alone.
   Shortening the end can't put it before the current period.
4. **Nesting — recommend: ending a parent asks about its children.**
   - A finished child stops feeding its parent from the period after its end.
     The parent's past counts stand.
   - Ending a parent offers to end its children on the same date. Children that
     carry on are detached (`parent_id` set to null, as when the parent is
     deleted), so no live goal hangs off a finished one.
   - `$domain/nesting` and `$domain/universe` must never see a finished goal as
     a parent.
5. **Where finished goals live.** Either a "Finished" section on
   `/goals/archived` (renamed to something like "Hangar") or its own route.
   Recommend the shared page with two sections: the mental model is "goals that
   aren't flying".
6. **Stats.** A finished goal's orbits count in `/stats` for the periods it flew,
   and completion rates don't count the periods after its end.
7. **Export and import.** `endsAt` goes in the goal bundle, defaulting to null
   for existing bundles.

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
