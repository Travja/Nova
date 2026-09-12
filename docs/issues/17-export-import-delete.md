---
title: Export, import, and delete your data
labels: [enhancement, backend]
milestone: 'M3 — Insight'
---

Nova is self-hosted and holds a personal record that is worth something. Getting
it out should be trivial, and so should getting rid of it.

**Build**

- Export everything as JSON: profile, goals, entries, with a schema version.
- Import from that JSON, either merging or replacing, with a dry-run summary
  before anything is written.
- Delete the account, which cascades through goals, entries and sessions — the
  foreign keys are already set up for it.

Import is the risky half. Validate with Zod, run it in a transaction, and never
partially apply.

**Done when**

- A full round trip of export, delete, import restores every goal and orbit
  exactly, including streaks.
- Account deletion leaves no orphaned rows.
