# Roadmap

The scaffold covers the full loop: sign up, launch a goal, log progress, watch an
orbit close. Everything beyond that is [tracked as issues][issues], with the full
spec for each one kept alongside the code in [`docs/issues/`](issues).

Each spec carries front matter with its title, labels and milestone, and a body
with enough context to pick up cold. They are specs, not tickets — read the one
you are about to build before you start. Issue numbers match the spec filenames,
so `docs/issues/12-nested-orbits.md` is issue #12.

Editing a spec does not update the issue on GitHub; keep the spec as the source
of truth and link to it from the issue when the two drift.

[issues]: https://github.com/Travja/Nova/issues

## M1 — Daily driver

The gaps that stand between "it works" and "I use it every day".

| #                                             | Issue                                                           | Why it matters                                            |
| --------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| [#1](https://github.com/Travja/Nova/issues/1) | [Today view](issues/01-today-view.md)                           | The tiered dashboard is the wrong first screen on a phone |
| [#2](https://github.com/Travja/Nova/issues/2) | [Archive and restore](issues/02-archive-restore.md)             | Archiving works; nothing can see or undo it               |
| [#3](https://github.com/Travja/Nova/issues/3) | [Edit and backdate entries](issues/03-edit-backdate-entries.md) | Forgetting to log on Sunday should not cost the week      |
| [#4](https://github.com/Travja/Nova/issues/4) | [Reorder goals](issues/04-reorder-goals.md)                     | `sortOrder` exists with no UI                             |
| [#5](https://github.com/Travja/Nova/issues/5) | [Offline logging](issues/05-offline-logging.md)                 | You log where the signal is worst                         |
| [#6](https://github.com/Travja/Nova/issues/6) | [Update prompt](issues/06-update-prompt.md)                     | Versions currently swap silently                          |
| [#7](https://github.com/Travja/Nova/issues/7) | [Accessibility pass](issues/07-accessibility-pass.md)           | The dial carries the meaning and does not expose it       |
| [#8](https://github.com/Travja/Nova/issues/8) | [Harden sign-in](issues/08-harden-signin.md)                    | No rate limiting, no password reset                       |

## M2 — The fun part

The reason to open the app rather than a spreadsheet.

| #                                               | Issue                                                                 | Why it matters                                    |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| [#9](https://github.com/Travja/Nova/issues/9)   | [Celebrate a closed orbit](issues/09-celebrate-closed-orbit.md)       | The best moment currently passes unnoticed        |
| [#10](https://github.com/Travja/Nova/issues/10) | [A body per tier](issues/10-tier-bodies.md)                           | Every tier draws the same circle today            |
| [#11](https://github.com/Travja/Nova/issues/11) | [Solar-system view](issues/11-system-view.md)                         | One sky instead of a grid of dials                |
| [#12](https://github.com/Travja/Nova/issues/12) | [Nested orbits](issues/12-nested-orbits.md)                           | Makes the tier ladder mean something mechanically |
| [#13](https://github.com/Travja/Nova/issues/13) | [A reactive mascot](issues/13-mascot.md)                              | Carries the emotional read of the app             |
| [#14](https://github.com/Travja/Nova/issues/14) | [Motion and theme preferences](issues/14-motion-theme-preferences.md) | Not everyone wants a moving starfield             |

## M3 — Insight

Turning a log into something you learn from.

| #                                               | Issue                                                       | Why it matters                                    |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| [#15](https://github.com/Travja/Nova/issues/15) | [History and heatmap](issues/15-history-heatmap.md)         | Twelve rings shows a streak, not a pattern        |
| [#16](https://github.com/Travja/Nova/issues/16) | [Stats](issues/16-stats.md)                                 | Cheap to derive from buckets already built        |
| [#17](https://github.com/Travja/Nova/issues/17) | [Export, import, delete](issues/17-export-import-delete.md) | It is your record; it should be portable          |
| [#18](https://github.com/Travja/Nova/issues/18) | [Orbit notes](issues/18-orbit-notes.md)                     | The reflection is about the period, not the entry |

## M4 — Reach and operations

Making it dependable, and making it speak up.

| #                                               | Issue                                                 | Why it matters                                    |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| [#19](https://github.com/Travja/Nova/issues/19) | [Push reminders](issues/19-push-reminders.md)         | An app that never speaks up is easy to forget     |
| [#20](https://github.com/Travja/Nova/issues/20) | [PWA polish](issues/20-install-and-shortcuts.md)      | Shortcuts, share target, iOS install guidance     |
| [#21](https://github.com/Travja/Nova/issues/21) | [Orbit rollups](issues/21-orbit-rollups.md)           | Dashboard cost scales with lifetime entries today |
| [#22](https://github.com/Travja/Nova/issues/22) | [Logging and errors](issues/22-logging-and-errors.md) | Debugging a self-hosted instance is guesswork     |
| [#23](https://github.com/Travja/Nova/issues/23) | [Automated backups](issues/23-backups.md)             | Years of history in one file                      |
| [#24](https://github.com/Travja/Nova/issues/24) | [Deployment guide](issues/24-deployment-guide.md)     | PWAs need HTTPS and an exact `ORIGIN`             |

## Deliberately not planned

Worth saying out loud, so they do not creep in:

- **Teams and shared goals.** A different product with different data modelling.
- **Gamified points, levels or leaderboards.** The orbit is the reward. Points on
  top of it would cheapen the metaphor and invite gaming your own tracker.
- **A native app.** The PWA is the delivery mechanism; a second client would
  double the surface for no gain Nova needs.
- **AI goal suggestions.** Nothing here is improved by guessing at your intent.
