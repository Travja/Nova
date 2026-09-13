---
title: Catch up a missed backup on start
labels: [ops]
milestone: 'M4 — Reach and operations'
---

Scheduled backups (#23) run as an interval inside the server process, and the
interval starts from launch. A container that restarts more often than the
interval may never reach one: a daily schedule on a machine power-cycled every
evening never sees twenty-four hours of uptime, and takes no snapshot at all.

That is the machine backups matter most on — a home server, a NAS, anything on a
timer or a UPS — so the schedule is quietly weakest exactly where it is most
needed. Nothing warns you; the logs show `backup schedule started` on every boot
and `backup taken` never follows.

**Build**

- On start, read the newest snapshot's timestamp and take one immediately if it
  is older than the configured interval, instead of always waiting a full
  interval from launch. `listSnapshots()` already returns the timestamps, so this
  is contained to `startBackupSchedule()` in `src/lib/server/backup/index.ts`.
- Keep the existing short delay before the first run, so a boot storm does not
  vacuum the database while the app is still answering its first healthcheck.
- An empty backup directory means "never backed up": take one rather than
  treating a missing timestamp as up to date.

**Done when**

- A container started with its newest snapshot older than the interval takes one
  shortly after boot.
- A container restarted minutes after a successful snapshot does not take
  another, so a restart loop cannot fill the disk with snapshots.
- Both are covered by tests against a scratch directory, without waiting on a
  real interval.

Retention runs after every snapshot, so a catch-up cannot grow the directory
beyond the policy — the worst case is one extra snapshot in a day that already
had one, and that day keeps only its newest either way.
