---
title: Automated SQLite backups
labels: [ops]
milestone: 'M4 — Reach and operations'
---

The README explains how to take a backup by hand. Nobody does that reliably, and
the entire record of years of habits is one file.

**Build**

- A scheduled `VACUUM INTO` or `.backup` snapshot to a configurable directory,
  which is safe on a live WAL database.
- Retention: keep the last N daily and M weekly snapshots.
- A documented restore procedure, and a test that proves a snapshot restores into
  a working database.
- Optional: a compose service or entrypoint schedule, so self-hosters get this
  without wiring up cron themselves.

That last bullet is answered by neither: the schedule is a `setInterval` in the
server process, started from `hooks.server.ts`. `VACUUM INTO` only reads, so a
sidecar container would be safe — it would just cost a second image carrying the
same retention rules, its own copy of the database path, and a log stream outside
the structured logger, while an entrypoint cron means supervising a second
process in an image whose command is already `migrate && start`. One container
that already holds the path, the config and the logger does the same job with
fewer moving parts. `runBackup()` stays a plain function over a config object, so
a sidecar or a cron entry remains possible later without reshaping anything.

Snapshots are bucketed in UTC, not in a user's time zone. Period boundaries
elsewhere in Nova are drawn per user because an orbit belongs to a person; a
backup schedule belongs to the server, and an instance whose pilots span three
time zones still keeps one snapshot per server day.

Daily and weekly winners are unioned rather than summed. The newest daily
snapshot is usually also its week's newest, so counting it twice would quietly
keep fewer distinct points in time than the two numbers suggest.

**Done when**

- Backups run on a schedule inside the container and rotate.
- Restoring a snapshot is documented and verified by a test.

**Later**

The interval restarts from zero whenever the container does, so a host that
reboots more often than the interval can go a long stretch with no snapshot at
all — a daily schedule on a machine power-cycled every evening may never reach
twenty-four hours of uptime. Backups are most valuable on exactly that kind of
machine, so this is worth closing before anyone relies on the schedule for a
server that is not always on.

The fix is a catch-up on boot: read the newest snapshot's timestamp at startup
and take one immediately if it is older than the interval, rather than always
waiting a full interval from launch. `listSnapshots()` already returns the
timestamps it needs, so it is a small change inside `startBackupSchedule()` —
left out of this pass deliberately rather than missed, and tracked as
[#29](https://github.com/Travja/Nova/issues/29)
([spec](29-backup-catch-up.md)).
