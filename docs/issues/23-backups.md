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

**Done when**

- Backups run on a schedule inside the container and rotate.
- Restoring a snapshot is documented and verified by a test.
