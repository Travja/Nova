# Roadmap

The scaffold covers the full loop: sign up, launch a goal, log progress, watch an
orbit close. Everything beyond that is tracked here as issue specs in
[`docs/issues/`](issues), ready to be created on GitHub with
`node scripts/seed-issues.mjs`.

Each file carries front matter with its title, labels and milestone, and a body
with enough context to pick up cold. They are specs, not tickets — read the one
you are about to build before you start.

## M1 — Daily driver

The gaps that stand between "it works" and "I use it every day".

| #                                        | Issue                     | Why it matters                                            |
| ---------------------------------------- | ------------------------- | --------------------------------------------------------- |
| [01](issues/01-today-view.md)            | Today view                | The tiered dashboard is the wrong first screen on a phone |
| [02](issues/02-archive-restore.md)       | Archive and restore       | Archiving works; nothing can see or undo it               |
| [03](issues/03-edit-backdate-entries.md) | Edit and backdate entries | Forgetting to log on Sunday should not cost the week      |
| [04](issues/04-reorder-goals.md)         | Reorder goals             | `sortOrder` exists with no UI                             |
| [05](issues/05-offline-logging.md)       | Offline logging           | You log where the signal is worst                         |
| [06](issues/06-update-prompt.md)         | Update prompt             | Versions currently swap silently                          |
| [07](issues/07-accessibility-pass.md)    | Accessibility pass        | The dial carries the meaning and does not expose it       |
| [08](issues/08-harden-signin.md)         | Harden sign-in            | No rate limiting, no password reset                       |

## M2 — The fun part

The reason to open the app rather than a spreadsheet.

| #                                           | Issue                        | Why it matters                                    |
| ------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| [09](issues/09-celebrate-closed-orbit.md)   | Celebrate a closed orbit     | The best moment currently passes unnoticed        |
| [10](issues/10-tier-bodies.md)              | A body per tier              | Every tier draws the same circle today            |
| [11](issues/11-system-view.md)              | Solar-system view            | One sky instead of a grid of dials                |
| [12](issues/12-nested-orbits.md)            | Nested orbits                | Makes the tier ladder mean something mechanically |
| [13](issues/13-mascot.md)                   | A reactive mascot            | Carries the emotional read of the app             |
| [14](issues/14-motion-theme-preferences.md) | Motion and theme preferences | Not everyone wants a moving starfield             |

## M3 — Insight

Turning a log into something you learn from.

| #                                       | Issue                  | Why it matters                                    |
| --------------------------------------- | ---------------------- | ------------------------------------------------- |
| [15](issues/15-history-heatmap.md)      | History and heatmap    | Twelve rings shows a streak, not a pattern        |
| [16](issues/16-stats.md)                | Stats                  | Cheap to derive from buckets already built        |
| [17](issues/17-export-import-delete.md) | Export, import, delete | It is your record; it should be portable          |
| [18](issues/18-orbit-notes.md)          | Orbit notes            | The reflection is about the period, not the entry |

## M4 — Reach and operations

Making it dependable, and making it speak up.

| #                                        | Issue              | Why it matters                                    |
| ---------------------------------------- | ------------------ | ------------------------------------------------- |
| [19](issues/19-push-reminders.md)        | Push reminders     | An app that never speaks up is easy to forget     |
| [20](issues/20-install-and-shortcuts.md) | PWA polish         | Shortcuts, share target, iOS install guidance     |
| [21](issues/21-orbit-rollups.md)         | Orbit rollups      | Dashboard cost scales with lifetime entries today |
| [22](issues/22-logging-and-errors.md)    | Logging and errors | Debugging a self-hosted instance is guesswork     |
| [23](issues/23-backups.md)               | Automated backups  | Years of history in one file                      |
| [24](issues/24-deployment-guide.md)      | Deployment guide   | PWAs need HTTPS and an exact `ORIGIN`             |

## Deliberately not planned

Worth saying out loud, so they do not creep in:

- **Teams and shared goals.** A different product with different data modelling.
- **Gamified points, levels or leaderboards.** The orbit is the reward. Points on
  top of it would cheapen the metaphor and invite gaming your own tracker.
- **A native app.** The PWA is the delivery mechanism; a second client would
  double the surface for no gain Nova needs.
- **AI goal suggestions.** Nothing here is improved by guessing at your intent.
