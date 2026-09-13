---
title: 'Asteroids: one-off tasks that never became a cycle'
labels: [enhancement, needs-design]
milestone: 'M2 — The fun part'
---

Everything in Nova is a revolution: progress accumulates inside a period, meets a
target, and the period resets. A one-off task has no period and no reset. Forcing
one into a goal — target of 1, cadence of "whenever" — makes the orbit and streak
machinery lie about what it is measuring, which is worse than not having the
feature at all.

An asteroid belt is matter that never coalesced into an orbiting body. That is
precisely what a one-off is relative to a goal: a fragment that never became a
cycle. Every tier is a body in orbit, so "asteroid" reads immediately as
something that plays by different rules.

## What an asteroid is

A title, an optional note, and a done state. One tap to clear it.

## What an asteroid deliberately does not get

No tier. No metric. No target. No period. No streak. No orbit history. No
entries.

**This list is the feature.** A to-do list bolted onto a goal tracker is how a
focused product becomes a mediocre version of two things. If a one-off starts
wanting a target and a cadence, that is not a gap — it is the signal that it
should become a goal, which is the next section.

Clearing an asteroid should also stay quieter than closing an orbit. A revolution
closing is the biggest moment in the app and nothing else may compete with it.

## Capture into orbit

The reason this is worth building rather than merely tolerating.

A one-off you keep re-adding should be capturable: "clean the garage" becomes a
Planet with a weekly target, and the asteroid records what it turned into rather
than vanishing. To-do-into-habit promotion is a genuinely useful thing to offer,
and the metaphor hands it over without needing to be justified.

An asteroid therefore has three terminal states, not one: **cleared** (done),
**captured** (became a goal), and **released** (let go deliberately).

## Drift, rather than a backlog of guilt

Every to-do app dies of an infinite backlog that turns into a reproach. The
metaphor supplies a better answer: asteroids **drift**. One left untouched long
enough moves outward and dims, and eventually Nova offers to release it.

Framed as orbital mechanics this reads as the natural fate of a rock nobody
captured, not as the app nagging. Releasing must be presented as a legitimate
outcome, on equal footing with clearing — not as a failure.

## Where it lives

In the Today view, as a band below the at-risk group — `focusForToday()` already
splits goals into at-risk, closed and steady. Asteroids are what you do when you
have ten spare minutes and nothing is due.

Not a new nav item. The header already carries four links, and giving the belt
its own destination is exactly what would turn it into a second product living
inside the first.

## Open questions — write a proposal on this issue before coding

1. **What offers the capture?** Re-adding a similar title, clearing the same
   asteroid text more than once, a manual "this keeps coming back" action, or
   some count-based heuristic? The heuristic decides whether this feels clever or
   presumptuous, and getting it wrong is worse than making it manual.
2. **Does drift decay from creation or from last touch?** Editing a note should
   probably not reset the clock; genuinely reconsidering it probably should.
3. **Does the belt have any order beyond drift?** Oldest drifting outward makes
   position and age the same fact, which is the trick the orbit dial already
   uses — progress and position saying the same thing twice.
4. **Does a released asteroid stay visible anywhere?** Archived goals keep their
   history; released asteroids arguably should not, or the backlog comes back by
   another name.

## Deliberately out of scope for a first pass

- **Due dates.** That is the launch metaphor — an event with a countdown — and it
  belongs to its own feature if it is ever wanted.
- **Attaching an asteroid to a parent goal** ("buy running shoes" under "run 3× a
  week"). Tempting, and it drags the nesting question from #12 in with it.
- **Sub-tasks.** If a one-off needs a checklist it is a project, and Nova is not
  a project tracker.

## Notes for whoever picks this up

- New table, so a migration: `pnpm db:generate` then commit the generated SQL.
- Ownership is checked inside the service functions, not the routes.
- This touches the Today view, which #10, #9 and #13 are currently changing.
  Land it after that work rather than alongside it.

## Done when

- A one-off can be added, cleared and released in under two taps from the Today
  view, on a phone.
- An asteroid can be captured into a goal of any tier, and the resulting goal is
  indistinguishable from one created directly.
- Nothing about an asteroid participates in streaks, orbit counts or history.
- A long-neglected belt reads as drifting rocks rather than as a list of
  failures.
