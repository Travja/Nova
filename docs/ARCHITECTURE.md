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
src/routes/       loading data, parsing forms, rendering
```

The rule that matters: **`domain/` never imports from `server/`**. Period
boundaries, orbit fractions, streaks and validation are all pure functions over
plain data. That keeps them fast to test (`src/lib/domain/*.test.ts` run in
milliseconds with no fixtures) and means the same code can run in the browser
when offline logging lands — the client will be able to compute an optimistic
orbit without waiting for a round trip.

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

The app shell is precached today. Offline _logging_ — queueing entries while
disconnected and reconciling them later — is a separate piece of work and the
reason the domain layer is kept free of server imports.
