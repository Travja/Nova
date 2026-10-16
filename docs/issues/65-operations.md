---
title: 'Operations: build the image in CI, keep dependencies moving, cut releases, prove a restore'
labels: [ops]
milestone: 'M4 — Reach and operations'
---

# 65 — Operations: image, dependencies, releases, a restore drill

CI being green says the code works on the CI runner's Node. Nothing yet says the
image works, that dependencies are getting their security fixes, which version a
server is running, or that a backup can actually be brought back. This issue
covers those four gaps. Each part can land on its own, in this order.

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

## 3. No releases

`package.json` says `0.0.1`, there are no tags, and `compose.yaml` builds from
whatever checkout is on the host. Upgrading means `git pull` and a rebuild on the
server. Rolling back means knowing which commit you were on before.

**A release workflow**, on a tag matching `v*.*.*`:

- Fail if `package.json`'s `version` does not equal the tag without its `v`. The
  tag is the source of truth, and the check stops the two drifting.
- Build the image and push it to `ghcr.io/travja/nova` as `<version>`,
  `<major>.<minor>` and `latest`.
- Build for `linux/amd64`. Add `linux/arm64` as well if it builds under QEMU in
  under about 15 minutes; self-hosters run Raspberry Pis. If it doesn't, ship
  amd64 only and say so in the PR, rather than making every release slow.
- Create a GitHub release with notes generated from the merged PRs.
- Use the default `GITHUB_TOKEN` with `packages: write`. No new secrets.

**Deployment:**

- `compose.yaml` uses `image: ghcr.io/travja/nova:${NOVA_VERSION:-latest}` by
  default. Building from source stays documented as the alternative.
- `DEPLOYMENT.md` § 7 Upgrading becomes: set `NOVA_VERSION`, `docker compose
pull`, `docker compose up -d`.
- Rolling back is the previous tag **plus** a snapshot from before the upgrade.
  Migrations only move forward, so an older image cannot run on a newer schema.
  The guide already says this; keep it, with tags in place of commits.

**Which version is running:** add `version` to the JSON `/health` returns, read
from `package.json` at build time. It stays anonymous and says nothing about the
data.

Cutting the first release, `v0.1.0`, is the owner's call. The PR sets up
everything up to that point and does not push a tag.

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

Once releases exist, the release workflow adds the stronger version: take a
snapshot with the **previous** tag's image and restore it into the new one. That
proves migrations bring an old snapshot up to date, which is the exact upgrade
path. Skip that step when there is no previous tag.

Point `DEPLOYMENT.md`'s "verify one before you need it" at the drill.

## Not in scope

- Deploying anywhere. A release publishes an image; the owner's server pulls it.
- Signing images or producing SBOMs. They're worth adding if the image is ever
  meant for people other than the owner.
- Renovate rather than Dependabot. Dependabot is enough, and it's built in.

## Done when

- A PR that breaks the `Dockerfile` fails CI in the `docker` job, and the job
  shows `/health` returning 200 for a good image.
- `.github/dependabot.yml` exists with the groups above, and `DEPLOYMENT.md` says
  to turn on security updates.
- Pushing a `v*.*.*` tag publishes the image to GHCR and creates a release. A tag
  that disagrees with `package.json` fails. `/health` reports the version.
  `compose.yaml` and § 7 pull an image by tag.
- The restore drill runs in CI and passes, following the README's steps as
  written.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass.
