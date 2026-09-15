# Nova

A goal tracker where goals are orbits. A goal belongs to a tier — Satellite
(daily), Planet (weekly), Star System (monthly), Galaxy (quarterly), Universe
(yearly) — and carries a metric and a target per revolution. Logging progress
moves the body around its ring; hitting the target closes an orbit and extends
the streak.

SvelteKit 2 with Svelte 5 runes, TypeScript, SQLite via Drizzle, deployed as a
Node server in Docker and installable as a PWA. There is no separate backend —
form actions are the API.

`docs/ARCHITECTURE.md` explains the reasoning behind all of this. Read it before
adding a subsystem.

## Commands

pnpm is the package manager; Node 22.

```bash
pnpm dev                 # dev server
pnpm test                # unit tests (fast, no fixtures)
pnpm e2e                 # Playwright journeys (builds first — see below)
pnpm check               # svelte-check, must be 0 errors
pnpm lint                # prettier --check plus eslint
pnpm db:generate         # after changing schema.ts
pnpm db:migrate          # apply migrations
```

Before opening a pull request: `pnpm lint && pnpm check && pnpm test && pnpm e2e`.

`pnpm e2e` runs two projects. `app` is the suite against the dev server on 4173;
`offline` is `e2e/offline-logging.spec.ts` against a production build on 4174,
because the service worker is not registered in dev and offline logging is
mostly the service worker. That is why the script builds before it tests.

## The one architectural rule

**`src/lib/domain/` never imports from `src/lib/server/` or from SvelteKit.**

Tiers, period maths, orbit progress and validation are pure functions over plain
data. That keeps them trivially testable and lets the same code run in the
browser — which is what offline logging (#5) collects: `overlayQueued()` in
`$domain/queue` computes an optimistic orbit from the queue with the same
`buildOrbit` and `streakFrom` the server used. Breaking this rule costs that, so
don't. The browser-only half of the queue — IndexedDB, retries, fetch — lives in
`src/lib/offline/` and holds no maths of its own.

Everything holding a secret or touching the database lives in `src/lib/server/`.
Routes parse forms and render; they do not build queries.

## Conventions

- **Aliases:** `$domain` → `src/lib/domain`, `$components` → `src/lib/components`,
  `$lib` → `src/lib`.
- **Runes are forced on** project-wide. Use `$state`, `$derived`, `$props`.
- **Links use `resolve()`** from `$app/paths` — an ESLint rule enforces it.
  Dynamic routes take params: `resolve('/goals/[id]', { id })`.
- **Form action failures** return `{ errors }` typed as `FormErrors` from
  `$domain/validation`. Use `fieldErrors(zodError)` or `formError(message)`;
  returning a bare object literal breaks type narrowing in the template.
- **Ownership is checked inside the service functions**, not in the route — see
  `logEntry()`, which re-reads the goal under the user's id before inserting. Keep
  new services doing the same so every caller gets the guarantee.
- **Compute snapshots through `src/lib/server/goals.ts`**, never by calling
  `snapshotGoal()` directly from a route. It needs `dormantWindows` passed or
  streaks silently break across spans the goal spent archived; the service loads
  them for you.
- **Migrations are committed and immutable.** Change `schema.ts`, run
  `pnpm db:generate`, commit the generated SQL. Never edit one that has shipped.
- **A goal with children is derived.** Its orbit counts closed child orbits, it
  cannot be logged against, and its amounts are in orbits — read the metric
  through `metricFor(snapshot)`, never `goal.metric`. Tree maths lives in
  `$domain/nesting`; the service loads the shape, the domain does the sums.
- **Timestamps are UTC epoch milliseconds.** Nothing stores a local time.
- **A log that can be retried carries a `clientId`.** `entries.client_id` is
  unique per goal and `logEntry()` conflicts on it, which is what stops the
  offline queue, the `online` listener and the service worker's replay from
  counting one entry three times. Never swap that for a read-then-write check.

## Time zones are the sharp edge

Period boundaries are computed in the user's own time zone via `Intl`, never by
adding fixed offsets. A day is 23 or 25 hours across a DST transition and the
tests assert exactly that.

**When you touch `src/lib/domain/period.ts`, add a test with a real DST date.**
The existing ones use `America/Denver` around 8 March and 1 November.

Nesting has its own version of the same edge: a closed child orbit counts toward
the parent period containing the child period's **end**, read as the last instant
it covers rather than the exclusive `period.end`. Nothing fails when that is
wrong — the orbit is quietly one out — so `nesting.test.ts` pins it at a week
that straddles a month boundary with a DST transition inside it.

Entries carry `occurredAt` separately from `createdAt` so work can be logged
after the fact. Anything that groups entries must use `occurredAt`.

## Animation

The space theme is the progress bar, not decoration on top of it. The orbit dial
maps a goal's fraction to an arc and puts the body at the matching angle, so
position and fill say the same thing twice.

- CSS and inline SVG only. No animation library, no Lottie, no raster assets.
- Everything yields to `prefers-reduced-motion`, handled globally in
  `src/lib/styles/app.css`.
- Anything random (the starfield) uses a seeded generator so server and client
  render identically. Plain `Math.random()` in a component will produce hydration
  mismatches.
- Size in pixels, not SVG user units, for anything inside a stretched viewBox —
  a `preserveAspectRatio="none"` SVG turns circles into ellipses.

## Gotchas

- `ORIGIN` must match the browsed URL in production or SvelteKit rejects form
  posts as cross-site. This is the most common deployment failure.
- `@vite-pwa/sveltekit` does not touch `app.html`. The manifest link is there
  explicitly and the service worker is registered in `+layout.svelte` on mount.
- `vite.config.ts` imports `defineConfig` from `vitest/config`, not `vite`,
  because it carries the test block.
- `better-sqlite3` compiles a native addon and is listed in
  `pnpm-workspace.yaml` under `onlyBuiltDependencies`.
- Playwright can reuse a preinstalled browser via
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; CI installs its own.

## Where the work is

Work is tracked as GitHub issues, grouped into four milestones. The original
set was #1–24; everything since is a follow-up filed while building, numbered as
GitHub assigned it. The full spec for each lives in `docs/issues/`, numbered to
match — `docs/issues/12-nested-orbits.md` is issue #12.

`docs/ROADMAP.md` indexes them all and marks the done ones, so it is the fastest
way to see what is left without opening GitHub.

Read the spec before starting; they carry context and a "done when" that the
issue body mirrors. The spec in the repo is the source of truth — if it drifts
from the issue, fix the spec.

`docs/ROADMAP.md` also lists what is deliberately **not** planned. Check it
before adding something speculative.
