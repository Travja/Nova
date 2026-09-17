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

## Decisions

These were open questions; this section settles them so the build session does
not re-decide them.

### 1. What offers the capture

**The clear action, on the third time the same title clears — never the add
action, and never a background scan of open asteroids.**

Every asteroid also carries a manual "this keeps coming back" action, available
from the moment it exists, so a person who already knows a one-off is really a
habit is never stuck waiting on a count. The count-based offer is the fallback
for the case that action exists to cover _before_ someone thinks to reach for
it.

Rejected alternatives, and why:

- **Offer on re-adding a similar title.** Adding is the wrong moment — it
  interrupts a two-tap capture with a decision before the thing is even back on
  the belt, and it requires fuzzy title matching to catch "clean the garage"
  vs. "clean garage", which is exactly the kind of cleverness that reads as
  presumptuous when it's wrong.
- **A background heuristic that surfaces the offer unprompted on the Today
  view.** The belt is already the "spare ten minutes" band; a proactive banner
  competing for attention there works against the "quieter than closing an
  orbit" rule the spec sets for asteroids generally.
- **Count without a floor (offer on the 2nd clear).** Two is a coincidence as
  often as it's a pattern — "renew car registration" clears twice a year for
  years and is never going to be a Planet. Three clears is a much stronger
  signal of a repeating cadence rather than a repeating category of task, and
  waiting for it costs nothing since the manual action is always there for
  someone who's already sure.

Mechanics: matching is on normalized title (trimmed, case-folded — no fuzzy
matching), and only **cleared** asteroids count toward the streak. A released
asteroid was explicitly let go, which is a vote against recurrence, not for it,
so it resets that title's count to zero rather than adding to it. The offer
fires inline in the response to the clearing action itself (the moment someone
is already looking at "clean the garage — done"), not as a separate
notification, and it is dismissible for that title without asking again until
the count restarts.

### 2. Drift: from creation, or from last touch

**From last touch, where "touch" means the title changes — not the note, and
not merely being viewed.**

The title is what makes an asteroid _this_ asteroid; editing it is reconsidering
what the rock is, which is exactly the moment its drift should reset. The note
is detail attached to that identity, so amending it leaves the clock alone —
otherwise jotting one more sentence on a stale asteroid would quietly hide how
stale it is. Viewing it doesn't touch it either, for the same reason opening a
goal doesn't reset a streak: looking is not doing.

This needs one column, not two: `driftAnchorAt`, initialized to `createdAt` and
reassigned whenever the title is edited. Everything downstream reads drift as
`now - driftAnchorAt`.

### 3. Order beyond drift

**No.** Oldest `driftAnchorAt` first, full stop — no manual drag-to-reorder, no
secondary sort. This is the same move the orbit dial already makes: position
and age are the same fact, so a second ordering axis would just be a second way
to say the same thing and a chance for the two to disagree. Goals get
`sortOrder` because a person's sense of what matters isn't chronological;
asteroids don't need that field because the belt is deliberately not a
prioritized list — it's what's left when nothing else is due.

### 4. Does a released asteroid stay visible

**No — not in any list.** The whole point of drift-and-release is that the
belt stops being a ledger of things not done; a "released" filter would just
be the backlog under a gentler name, which is the exact failure mode the spec
calls out. The row is not deleted (see the export/import note below — this is
still the account's data), but no view queries for `resolution = 'released'`.
Contrast with archived goals, which stay visible on purpose because an archived
goal is paused work someone may resume and its history still counts toward
streak maths; a released asteroid was never going to have history, and nothing
downstream needs to find it again.

## Sketch: schema and the domain/service split

Not a spec to implement verbatim — concrete enough that the build session isn't
re-deriving the shape from scratch.

### Table

```ts
export const asteroids = sqliteTable(
	'asteroids',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		note: text('note'),
		createdAt: timestamp('created_at').notNull(),
		/** The drift clock. Starts at createdAt; reassigned when the title changes. */
		driftAnchorAt: timestamp('drift_anchor_at').notNull(),
		/** Null while active. One of 'cleared' | 'captured' | 'released' once resolved. */
		resolution: text('resolution'),
		resolvedAt: timestamp('resolved_at'),
		/** Set only when resolution is 'captured' — the goal this asteroid became. */
		capturedGoalId: text('captured_goal_id').references(() => goals.id, {
			onDelete: 'set null'
		})
	},
	(table) => [
		index('asteroids_user_id_idx').on(table.userId),
		// Backs the recurrence count in `clearAsteroid()` — same normalized title,
		// same user, resolution = 'cleared'.
		index('asteroids_user_title_idx').on(table.userId, table.title)
	]
);
```

One `resolution` column with three string values rather than three nullable
timestamp columns, for the same reason `metricKind` is a text column read
through an app-side union: the three terminal states are mutually exclusive,
and a single discriminator makes that a fact the type checker can see instead
of an invariant three columns have to maintain by convention. `capturedGoalId`
uses `set null` for the same reason `parentId` does on `goals` — deleting the
goal an asteroid became must not take the historical fact of the capture with
it.

### Domain: `$domain/asteroids.ts`

Pure functions over plain data, no database, same rule as everything else
under `$domain`:

- `normalizeTitle(title)` — trim and case-fold, the one normalization step
  behind both the capture count and the (intentionally absent) fuzzy matching.
- `recurrenceCount(title, resolvedAsteroids)` — count of `cleared` minus reset
  on `released`, over a caller-supplied list, per decision #1.
- `shouldOfferCapture(count)` — the `count >= 3` threshold as a named function
  rather than a bare literal at the call site, the way `CLOSING_FRACTION` and
  `ADRIFT_SHORTFALL` are named elsewhere.
- `driftBand(asteroid, now)` — buckets `now - driftAnchorAt` into whatever the
  belt's visual stages turn out to be (fresh / drifting / faint), and a
  `DRIFT_RELEASE_OFFER_MS` constant (propose 21 days — three weeks, long enough
  that a slow week doesn't trigger it, short enough that the belt doesn't
  silently become the backlog decision #4 is trying to avoid) past which the
  release offer becomes available.
- `sortBelt(asteroids, now)` — oldest `driftAnchorAt` first, per decision #3.

None of this touches `focusForToday()` or `FocusRow` — asteroids are not
goals and don't produce `GoalSnapshot`s, so the Today view sketch below reads
the belt as a second, separate list rendered under the existing bands rather
than a new case inside `TodayFocus`.

### Service: `src/lib/server/asteroids.ts`

Same ownership pattern as `goals.ts` — every function re-reads the row under
the caller's `userId` rather than trusting an id alone:

- `listAsteroids(userId)` — active asteroids, sorted with `sortBelt()`.
- `createAsteroid(userId, { title, note })`.
- `clearAsteroid(userId, id)` — sets `resolution: 'cleared'`, `resolvedAt`;
  loads this user's asteroids sharing the normalized title and returns whether
  to show the capture offer via `shouldOfferCapture(recurrenceCount(...))`.
- `releaseAsteroid(userId, id)`.
- `captureAsteroid(userId, id, input: GoalInput)` — re-reads the asteroid under
  `userId`, delegates to the existing `createGoal(userId, input)` so the
  resulting goal goes through the same nesting and validation checks as one
  created directly (the "indistinguishable" requirement in Done when), then on
  success stamps `resolution: 'captured'`, `resolvedAt`, `capturedGoalId`.
- `updateAsteroidTitle(userId, id, title)` — the one place `driftAnchorAt` gets
  reassigned, per decision #2. A separate function from a general "edit" so
  editing the note doesn't have to remember not to touch the clock.

### Today view

`+page.server.ts` loads `listAsteroids(locals.user.id)` alongside
`listGoalSnapshots()` and hands both to the template; `+page.svelte` renders
the belt as its own band below `focus.steady`, gated the same way the other
bands already are (nothing rendered when the list is empty). Clearing posts to
a new form action the same shape as `today`'s existing `log` action; a
successful clear response carries the capture-offer flag so the template can
show the "make this a Planet?" prompt inline without a page reload.

## What this adds to #17 (export, import, delete)

Written now so #17 can be scoped against a known shape instead of waiting on
this issue to land and then re-opening the schema question.

**Export** includes every asteroid the account owns, in every state — active,
cleared, captured and released — because export is about data ownership, not
about what the UI currently chooses to display; decision #4 hides released
asteroids from the app, not from the account's own copy of its data. Each
row exports `title`, `note`, `createdAt`, `driftAnchorAt`, `resolution`,
`resolvedAt`, and, for a captured asteroid, the id of the goal it became.

**Import** creates asteroid rows in whatever state the export recorded,
including resolved ones — a cleared or released asteroid re-imports as
cleared or released, not as a fresh active one, the same way an archived goal
re-imports archived rather than restored. `capturedGoalId` re-links only when
the goal it names is also present in the same import bundle (the same rule a
re-imported `parentId` needs); when it isn't, the import drops the reference
but keeps `resolution: 'captured'` and `resolvedAt` — the fact that it became
a goal survives even when that goal isn't part of this import.

**Delete** (of the account) removes asteroids the same way it removes goals:
`onDelete: 'cascade'` from `users`, no special casing.

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
