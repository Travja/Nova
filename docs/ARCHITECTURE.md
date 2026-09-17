# Architecture

Why Nova is shaped the way it is, and where new work belongs.

## One app, no separate backend

SvelteKit's server routes are the API. Form actions handle every mutation, so
each screen works without JavaScript and gets progressive enhancement for free
when it loads. A separate Express or Nest service would buy nothing here and
would double the deploy surface.

If a JSON API becomes necessary — a watch app, a CLI, a third-party
integration — it should be added as `+server.ts` endpoints that call the same
functions in `src/lib/server/` that the form actions call. The services, not
the routes, are the contract.

## Layers

```
src/lib/domain/   pure, portable logic — no database, no SvelteKit imports
src/lib/server/   persistence and anything holding a secret
src/lib/offline/  the browser's side of the sync queue — storage, retries, fetch
src/routes/       loading data, parsing forms, rendering
```

The rule that matters: **`domain/` never imports from `server/`**. Period
boundaries, orbit fractions, streaks and validation are all pure functions over
plain data. That keeps them fast to test (`src/lib/domain/*.test.ts` run in
milliseconds with no fixtures) and means the same code runs in the browser:
`overlayQueued()` in `domain/queue.ts` folds the entries the offline queue is
still carrying into the snapshot the server sent, using `bucketByPeriod`,
`buildOrbit` and `streakFrom` unchanged. The optimistic orbit is not a second
implementation of the maths, and cannot drift from the first.

## Periods are the hard part

Everything else is bookkeeping; the subtle logic is deciding which revolution a
logged entry belongs to.

- Timestamps are stored as UTC epoch milliseconds. Nothing anywhere stores a
  local time.
- Boundaries are computed in the user's time zone via `Intl.DateTimeFormat`,
  not by adding fixed offsets. A day is 23 or 25 hours long across a daylight
  saving transition, and the tests assert exactly that.
- `periodFor()` returns a `key` (`week:2026-W37`) as well as instants. Grouping
  entries by that key is how progress is summed, which avoids comparing
  boundary instants in a loop.
- Week starts are per-user. ISO week numbering is only used when weeks start on
  Monday; other starts key on the week's own start date.

When you touch `src/lib/domain/period.ts`, add a test with a real DST date. The
existing ones use `America/Denver` around 8 March and 1 November.

## Storage

SQLite through Drizzle, in WAL mode. For a single-user-per-account tracker this
is the right size of tool: one file to back up, no service to run, and Drizzle's
generated migrations are plain SQL you can read.

Schema lives in `src/lib/server/db/schema.ts`. After changing it:

```bash
pnpm db:generate   # writes drizzle/NNNN_*.sql
pnpm db:migrate    # applies it
```

Migrations are committed. Never edit one that has shipped.

If Nova ever needs Postgres — concurrent writers, or a hosted multi-tenant
deployment — the change is contained to `src/lib/server/db/` plus the Drizzle
dialect, because routes never build queries themselves.

### Archive windows

`goals.archivedAt` answers "is this archived right now"; `goal_archive_windows`
answers "when was it asleep", one row per archive/restore cycle. The streak
maths treats an orbit that falls wholly inside a window as neither closed nor
missed, which is what lets archiving freeze a streak instead of breaking it.
Windows are passed into `snapshotGoal()` as plain data, so the rule stays in the
domain layer with everything else.

### Nested orbits

`goals.parent_id` is a self-reference with `ON DELETE SET NULL`: deleting a Star
System orphans the weekly habits under it rather than taking them with it.

A goal with children is **derived** — its orbit counts the closed orbits of its
direct children rather than anything logged against it, and `logEntry()` refuses
entries for one. The maths is `$domain/nesting`, pure over already-loaded
children exactly as the archive windows are: `src/lib/server/goals.ts` loads the
forest once, `snapshotWithChildren()` decides whether a goal is a leaf, and
nothing in `$domain` reaches for a row.

Three rules are enforced at write time rather than found at read time — the
parent must be the same user's, its cadence must be strictly longer, and the
graph must stay acyclic. A cycle discovered while rendering is a stack overflow
in the middle of a dashboard; a cycle refused at the edge is a form error.

The subtle part is which of the parent's periods a closed child orbit counts
towards: the one containing the child period's **end**, read as the last instant
that period covers rather than as its exclusive `end`. A week finishing on the
last day of October belongs to October; `period.end` for that week is 1 November.
Getting it wrong fails nothing and moves every straddling orbit by one.

### A known limit

`listGoalSnapshots()` loads every entry for every goal to compute lifetime orbit
counts. That is fine for thousands of entries and wrong for millions. The fix,
when it matters, is a rollup table of closed orbits per goal per period, written
as entries are logged.

## Sessions

Hand-rolled and deliberately small:

- A random 32-byte token goes to the browser in an `httpOnly`, `sameSite=lax`
  cookie. Only its SHA-256 is stored, so a leaked database cannot be used to
  impersonate anyone.
- Passwords use Argon2id with the OWASP-recommended parameters.
- Sessions last 30 days and extend when used past the halfway mark.
- `hooks.server.ts` resolves the session once per request into `event.locals`.

Ownership is checked inside the service functions rather than in the routes, so
every caller gets the same guarantee — see `logEntry()`, which re-reads the goal
under the user's id before inserting.

## The visuals

[`VISUALS.md`](VISUALS.md) is the illustrated tour of this section — every body,
the celebration, the pilot's moods, and what each rule below costs when it is
broken.

The space theme is not decoration bolted on afterwards; the orbit is the
progress bar. `OrbitDial.svelte` maps a goal's fraction to an arc and puts the
body at the matching angle, so position and fill say the same thing two ways.

`TierBody.svelte` draws the body itself, inside a unit circle that the caller
scales into place — which is why the same component works on a 230px hero dial
and on a 24px ring in the history strip. Anything finer than a pixel is dropped
rather than drawn small.

Each tier is a family rather than a stamp: `src/lib/components/bodies/` holds a
few bodies per tier, and `bodyVariant()` in the domain picks one by hashing the
goal's id. Pinning it to the id rather than storing it on the row means there is
no column to migrate and no way for a body to change under a goal that has been
flying for a year — ids never change, and titles, colours and tiers do.

Rules for anything animated:

- Everything is CSS or inline SVG. No animation library, no Lottie, nothing that
  ships a runtime for decoration.
- Every animation yields to `prefers-reduced-motion` — handled globally in
  `src/lib/styles/app.css`. Position has to carry the meaning without it, which
  is why bodies are placed by the arc's angle and never by an animation.
- Anything random (the starfield, a universe's field of light) uses a seeded
  generator so server and client render identically and hydration stays quiet.

Two things react to the data rather than just drawing it, and both keep the
decision in `src/lib/domain/`:

- **Closing an orbit** (`celebration.ts`) has to fire once, on the closing
  itself, when every log re-renders the whole page. The rule is "this browser
  saw the same period open, then closed"; `src/lib/celebration.svelte.ts` holds
  that memory for the tab, fed by the pages from an effect, so the server never
  has an opinion about it.
- **The mascot's mood** (`mascot.ts`) is read off the same `focusForToday` split
  the focused view is drawn from, so the drawing and the list cannot disagree.

## PWA

`@vite-pwa/sveltekit` generates `manifest.webmanifest` and a Workbox service
worker at build time. The plugin does not touch `app.html`, so the manifest link
lives there explicitly and the worker is registered in `+layout.svelte` on
mount, skipped in dev.

`navigateFallback` is explicitly `undefined`. The plugin defaults it to the
base path, which generates `createHandlerBoundToURL('/')` — and with
`adapter-node` and nothing prerendered, `/` is not in the precache manifest, so
that call throws while the worker is being evaluated and the worker never
installs at all. Navigations are served by a `NetworkFirst` runtime route
instead, which is also what puts a page in the cache for a reload to land on
while offline.

### Offline logging

The queue is in three pieces, and the split is the design:

- **`domain/queue.ts`** is pure. It says what a queued entry does to an orbit,
  by running the same functions the server's snapshot was built with.
- **`lib/offline/`** is the browser's half: an IndexedDB store, an `enhance`
  wrapper that catches a log the network could not take, and a flush with a
  backoff. Nothing here knows any maths.
- **`POST /api/entries`** is where a flush lands. It is the one place that is
  not a form action, because a queued entry carries the instant it was made and
  the id that makes a retry safe, several arrive at once, and a service worker
  replays it far more comfortably than it replays a form post.

Idempotency is a constraint, not a check: `entries.client_id` is unique per
goal and the insert conflicts on it. A read-then-write would race two retries
against each other, and there are three things that can deliver the same entry
— the page's own flush, the `online` listener, and Workbox's Background Sync
replay, which is the one that works with the tab closed. Safari has no
Background Sync, which is why the other two exist.

An entry carries `occurredAt` from the moment it was made, and nothing on the
way in restamps it: logged on Monday, flushed on Wednesday, it closes Monday's
orbit. The flush is held to the same `occurredAtBounds` a backdated entry is,
so it cannot invent history before the goal launched, and `CLOCK_SKEW_MS`
keeps a phone running a few minutes fast from being told its own present is the
future.

The queue belongs to the browser rather than to the account, which has one
consequence worth naming: sign out with entries still waiting and the flush is
refused, because the goals are not the signed-in user's. They are reported in
the queue bar with the reason rather than written to the wrong account, and
rather than disappearing quietly.

### Reminders

Push is the second thing the service worker does, and it was added by
`importScripts`ing `static/push-sw.js` from the generated worker rather than by
switching to `injectManifest`. A custom worker would mean owning the precache,
the Background Sync queue above and the `SKIP_WAITING` listener `UpdatePrompt`
posts to — and that last one fails silently when it is forgotten.

The split is the same as everywhere else:

- **`domain/reminders.ts`** decides. Which orbit is worth interrupting someone
  for, whether the hour is inside their quiet window, whether today's one
  reminder is already spent, and the exact words. It is pure, so every rule is
  a unit test rather than a notification somebody has to wait for.
- **`lib/server/push/`** has the database and the network: the subscriptions,
  the VAPID configuration, the 15-minute sweep, and one call into `web-push`.

Three decisions worth keeping:

- **Nothing private goes in a payload.** A notification is read by whoever is
  holding the phone, so a reminder carries counts and cadences, never a goal's
  title, and never an id. The tap opens `/today`, which is behind the session.
- **Quiet hours and "late in the day" are local.** Both are wall-clock ideas,
  so they are stored as minutes past midnight and resolved against the
  account's own zone — the same rule the period maths follows.
- **A device that is gone is deleted, not retried.** A 404 or a 410 from a push
  service is final, and retrying it forever is how a sender gets rate-limited
  for delivering to nobody.

`web-push` is the one dependency this brought in. The alternative was
implementing RFC 8291 — ECDH over P-256, HKDF, AES-128-GCM, and a VAPID JWT —
which Node has every primitive for, but whose failure mode is silence on
somebody's phone rather than a test going red.

## The server's clock

Every request answers against one instant, `locals.now`, set in
`hooks.server.ts`. Two reasons. A goal must not be measured against one clock
and ranked against another inside the same render. And whether an orbit is
running out of time depends on the hour — after #48 a satellite is only closing
in the last quarter of its day — which makes `new Date()` inside a load
function untestable.

In development only, a `nova_clock` cookie can pin that instant: `21:00` moves
the hour and keeps the date, and a full `2026-03-01T21:00` moves both. The gate
is `dev` from `$app/environment`, which Vite replaces with a literal `false` in
a production build, so the override is not merely skipped in production — it is
not in the bundle. Nothing reads the environment, so there is no variable that
turns it back on.

Writes are deliberately not routed through it. Entries and goals are stamped by
the ordinary clock, which is why the hour-only form of the cookie is the one an
end-to-end test uses when it logs something: the date is unchanged, so what it
writes still lands in the period it is looking at.
