---
title: 'Operations: build the image in CI, keep dependencies moving, cut releases, prove a restore'
labels: [ops]
milestone: 'M4 — Reach and operations'
---

# 65 — Operations: image, dependencies, releases, a restore drill

CI being green says the code works on the CI runner's Node. Nothing yet says the
image works, that dependencies are getting their security fixes, or that a
backup can actually be brought back. This issue covers those gaps — a fourth,
cutting tagged releases, was drafted and then dropped; see §3. Each part can
land on its own, in this order.

## 1. CI never builds the Docker image

`.github/workflows/ci.yml` runs lint, check, test, build and e2e on the runner's
own Node. It never runs `docker build`. The `Dockerfile` is Alpine with a
toolchain so `better-sqlite3` can compile its native addon against musl. Any of
these breaks the image and nothing else, so it fails first on the server, in the
middle of an upgrade:

- a change to the `Dockerfile`;
- a change to `onlyBuiltDependencies` in `pnpm-workspace.yaml`;
- a Node bump;
- a `better-sqlite3` release that won't compile on musl.

**Add a `docker` job** to CI, running on pull requests and on `main`:

- Build the image with `docker/build-push-action`, using the GitHub Actions layer
  cache. It never pushes from this job.
- Run the image with an empty volume and an `ORIGIN`, then poll `/health` until
  it returns 200, failing after 60 s. That one check proves that:
  - the native addon loads;
  - migrations run against a fresh database;
  - the server starts and the database answers.
- On failure, print `docker logs` so the reason is in the job output.

## 2. Nothing updates dependencies

There is no Dependabot or Renovate. `three` and `@types/three` are pinned exactly
(#11), so they never move on their own. Nothing flags a security release of
SvelteKit, `better-sqlite3`, `web-push` or `nodemailer`.

**Add `.github/dependabot.yml`:**

- **npm, weekly.** Minor and patch updates are grouped, one PR for runtime
  dependencies and one for dev dependencies. Major updates get one PR each.
- **`three` and `@types/three` in a group of their own.** three breaks things in
  minor releases. CI already runs the `universe` Playwright project, and the PR
  body should say to check the universe chunk's gzipped size against the 180 kB
  budget.
- **GitHub Actions, weekly.**
- **The Docker base image (`node:22-alpine`), weekly.**
- `open-pull-requests-limit: 5`, so a quiet month does not turn into twenty PRs.

Dependabot security updates are a repository setting, not a file. Put a line in
`DEPLOYMENT.md` saying to switch them on, and say so in the PR.

## 3. No releases — not pursued

`package.json` says `0.0.1`, there are no tags, and `compose.yaml` builds from
whatever checkout is on the host. A tag-triggered release workflow pushing
images to `ghcr.io/travja/nova` was drafted for this issue (#72), but
`compose.yaml` is the only consumer of that image — there is no second
deployment path a published image would serve. Publishing one just to pull it
straight back down adds a registry hop with nothing on the other end to
justify it, so the release workflow, the GHCR push and the `version` field on
`/health` were all dropped before merging. Deployment stays `git pull &&
docker compose up -d --build`, exactly as it was before this issue.

If a second consumer of the image ever shows up — a hosted trial, a second
self-hoster who isn't you, anything that needs to pull rather than build —
this is where that release workflow would go, and the draft in #72's history
is the starting point.

## 4. A backup has never been restored

Backups are taken (#23), caught up after reboots (#29) and pruned. The README
has a restore procedure. Nothing has ever followed that procedure and checked
what came back.

**A restore drill**, as a script and a CI job:

1. Start the built image on an empty volume, and create an account with a goal
   and some entries through the app's own forms or HTTP. Don't write SQL for
   this.
2. Get a snapshot from Nova's own backup code. On start with no snapshot, the
   #29 catch-up takes one; or use a short `BACKUP_INTERVAL_HOURS`. The point is
   to test the snapshot Nova makes, not one the script made with `sqlite3`.
3. Follow the README's _Restoring_ steps exactly: stop the container, copy the
   snapshot over `nova.db`, delete `-wal` and `-shm`, and start the container
   again. If a step turns out to be wrong, fix the README in the same PR.
4. Check that the account, goal and entry count came back, by signing in and
   reading the page, or through `sqlite3` on the volume.

The stronger version of this — a snapshot taken with one tagged image and
restored into the next, proving migrations bring an old snapshot up to date —
only makes sense once there are tagged images to compare, which §3 decided
against. Nothing left to add here unless that changes.

Point `DEPLOYMENT.md`'s "verify one before you need it" at the drill.

## Not in scope

- Publishing an image at all. See §3 — `compose.yaml` building from source is
  the only deployment this project has, and a registry push just to pull it
  back down buys nothing without a second consumer.
- Deploying anywhere. If a release workflow is ever built, it publishes an
  image; the owner's server pulls it.
- Signing images or producing SBOMs. They're worth adding if the image is ever
  meant for people other than the owner.
- Renovate rather than Dependabot. Dependabot is enough, and it's built in.

## Done when

- A PR that breaks the `Dockerfile` fails CI in the `docker` job, and the job
  shows `/health` returning 200 for a good image.
- `.github/dependabot.yml` exists with the groups above, and `DEPLOYMENT.md` says
  to turn on security updates.
- The restore drill runs in CI and passes, following the README's steps as
  written.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass.
