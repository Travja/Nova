---
title: Notes and reflections on an orbit
labels: [enhancement]
milestone: 'M3 — Insight'
---

Entries carry a short note; orbits carry nothing. The interesting reflection is
usually about the period as a whole — why a week went badly, what made a month
work. An entry note says "ran 5k". Nobody has anywhere to say "knee played up
all week, so this was a win".

An optional note attached to a period rather than an entry, written from the
history view, read back beside the orbit it belongs to.

Keep it optional and keep it fast. A prompt that must be dismissed every day
will be resented within a week.

## Decisions

The original of this spec was three lines long and predates #15's history page,
#30 and the celebration work in #51. These settle what it left open so the
build session is not inventing them alongside the code.

### 1. What a note is keyed to

**`(goalId, periodKey)`, unique, storing `periodStart` alongside it.**

Orbits are not rows. They are computed from entries by `periodFor()` and
`bucketByPeriod()`, so a note cannot reference one by id — the only stable
handle an orbit has is `period.key`. That is also how everything else already
joins period-shaped data: `historyCells(history, detailsByPeriod)` pairs orbits
with what landed in them through a `Map` keyed by exactly that string. Notes
join the same way, which is most of why the history page gets this nearly free.

`periodStart` is stored as well, as UTC epoch milliseconds, because the key
alone is not durable — see the next decision.

### 2. What happens when the pilot redefines their periods

**The note survives, stops appearing against a recomputed orbit, and is
recoverable from `periodStart` and `cadence`. Say so out loud rather than
pretending it cannot happen.**

This is the sharp edge of the whole issue, and it is silent. A period key is
computed in the pilot's own time zone and week start, and its _shape_ changes
with the week start:

```
weekStartsOn = 1  →  week:2026-W38          (ISO week)
weekStartsOn ≠ 1  →  week:2026-09-20        (the start date)
```

So a pilot who switches their week from Monday to Sunday orphans every weekly
note they have ever written: the stored keys match nothing the domain now
computes, the notes vanish from the history page, and nothing anywhere reports
an error. Changing time zone does the same to daily notes across the shift.

There is no scheme that avoids this. Keying on the start instant instead just
moves the problem — redefining a week changes which instant a week starts at,
so the note lands on a boundary that no longer exists either. Every option
rebases something, so the requirement is not "never orphan" but **never lose,
and never silently mislead**:

- The row is never deleted by a preference change.
- `periodStart` plus the goal's cadence is enough to find the orbit a note was
  written against, so a later migration or repair can rebuild the keys.
- Export carries the note whatever state its key is in (see below).

A recovery pass that re-keys orphaned notes on a preference change would be a
good follow-up. It is deliberately **not** in this issue: get the data right
first, and file the repair once there is data to repair.

### 3. Where the note is written — and where it is not

**On the history view, per orbit. Never as a prompt at the moment an orbit
closes.**

The original spec asked for "a prompt when an orbit closes or lapses". Do not
build that. Closing an orbit is the single biggest moment in the app, #9 built
a whole celebration for it, #51 went to some trouble to stop that moment being
lost, and #30 is under standing orders to stay quieter than it. A dialog asking
for prose on top of the burst would trample the thing every one of those issues
exists to protect — and it is the daily-dismissal fatigue this spec's own
second paragraph warns about.

So:

- **History page** (`/goals/[id]/history`) is the home. `OrbitList` already
  draws one row per orbit with what landed in it; the note belongs there, shown
  when present and added or edited in place.
- **The goal sheet** may offer the current orbit's note, since that is where
  someone already is when they think of something worth writing.
- **After the celebration, if anywhere**: a quiet inline link on the closed
  orbit, appearing once the celebration has finished and never blocking
  anything. Optional — build it only if it costs nothing, and drop it rather
  than let it compete.

### 4. Whether a derived goal can carry one

**Yes.** A parent's orbit is a real orbit — it counts closed child orbits, it
has a period and a key — and a note about how a quarter went is, if anything,
more interesting at the parent. Nothing about notes touches the maths, so there
is no reason to special-case it. `metricFor(snapshot)` still governs how its
amounts read; a note does not care.

## Shape

### Table

```ts
export const orbitNotes = sqliteTable(
	'orbit_notes',
	{
		id: text('id').primaryKey(),
		goalId: text('goal_id')
			.notNull()
			.references(() => goals.id, { onDelete: 'cascade' }),
		/** `period.key` — `week:2026-W38`, `month:2026-09`. The join. */
		periodKey: text('period_key').notNull(),
		/** The same period's start, so the note is recoverable when a key is not. */
		periodStart: timestamp('period_start').notNull(),
		body: text('body').notNull(),
		createdAt: timestamp('created_at').notNull(),
		updatedAt: timestamp('updated_at').notNull()
	},
	(table) => [unique('orbit_notes_goal_period_idx').on(table.goalId, table.periodKey)]
);
```

Cascade from `goals` rather than from `users`: a note is about one goal's
period and means nothing without it, which is not true of an asteroid.

No `userId` column — ownership comes through `goalId`, and the service re-reads
the goal under the caller before touching a note, the same way `logEntry()`
does.

### Service: `src/lib/server/orbit-notes.ts`

- `notesForGoal(userId, goalId)` → `Map<periodKey, OrbitNote>`, ready to hand
  to the history page the way `detailsByPeriod` already is.
- `writeOrbitNote(userId, goalId, { periodKey, periodStart, body })` — upsert on
  the unique pair, so editing is the same call as writing.
- `deleteOrbitNote(userId, goalId, periodKey)` — an empty body deletes rather
  than storing `''`.

Every one re-reads the goal under `userId` first.

### Domain

Very little belongs in `$domain`: a note is text, and the period maths already
exists. What does belong is the join — extend `HistoryCell` with the note for
its period, the way `details` is already attached, so a page never pairs them
by hand. Validation (length cap, trimming) goes in `$domain/validation` beside
the others.

## What this adds to #17 (export, import, delete)

Written now so #17 can be scoped once, the same way #30 did.

**Export** carries every note: `goalId`, `periodKey`, `periodStart`, `body`,
`createdAt`, `updatedAt` — including notes whose key no longer matches a
computed period, per decision #2. Export is about owning the data, not about
what the history page can currently draw.

**Import** restores notes against the goals in the same bundle, dropping a note
whose goal is absent, since the cascade says a note without its goal is not a
thing. A note re-imports with its original `periodKey` rather than a recomputed
one: the importing account may have a different week start, and rewriting the
key on the way in would quietly reassign the note to a period it was never
about.

**Delete** of the account removes them through the cascade from `goals`.

## Done when

- A note can be attached to any past or current orbit and read back in history.
- Nothing about the flow forces a note to be written, and nothing prompts for
  one on top of a closing celebration.
- Editing a note is the same path as writing one; clearing it removes the row.
- A derived goal's orbits can carry notes like any other.
- A note outlives a change to the pilot's week start or time zone, even where
  it stops being displayed — there is a test that changes the preference and
  asserts the row is still there with its `periodStart` intact.
