---
title: Export, import, and delete your data
labels: [enhancement, backend]
milestone: 'M3 — Insight'
---

Nova is self-hosted and holds a personal record that is worth something. Getting
it out should be trivial, and so should getting rid of it.

- **Export** everything the account owns as one JSON file, with a schema version.
- **Import** from that file, merging or replacing, with a dry-run summary before
  anything is written.
- **Delete** the account, which cascades through everything.

Import is the risky half: it writes caller-supplied JSON into the database.
Validate with Zod, run it in one transaction, and never partially apply.

## Decisions

The original of this spec named "profile, goals, entries", which was the whole
schema when it was written. There are now ten tables, some of them holding
credentials. These settle what the build session would otherwise be inventing
while it writes an importer.

### 1. What is in the file, and what must never be

**Exported:** the profile (`email`, `displayName`, `timeZone`, `weekStartsOn`,
`preferences`, `createdAt`), `goals`, `goalArchiveWindows`, `entries`,
`asteroids`, `orbitNotes`, and `reminderSettings` minus `lastSentAt`.

**Never exported:**

| Not in the file               | Why                                                    |
| ----------------------------- | ------------------------------------------------------ |
| `users.passwordHash`          | A credential. Nothing about a restore needs it.        |
| `sessions`                    | Live bearer tokens — the file would be a set of keys.  |
| `passwordResetTokens`         | Same, with a shorter fuse.                             |
| `pushSubscriptions`           | Endpoint plus auth keys: anyone holding them can push. |
| `reminderSettings.lastSentAt` | Server bookkeeping, not the pilot's record.            |

This is the decision most worth getting right, because getting it wrong is
invisible. An export is a plaintext file that lands in a Downloads folder and
often gets mailed to its owner "to keep safe". A session that serialises "the
user row" ships an argon2 hash and a working set of push credentials with it.
Build the export from an explicit allowlist of columns per table, never
`select *` minus a deny-list, so the next column added to `users` is absent by
default rather than present by accident.

Devices are deliberately not portable. Restoring an account leaves it with no
sessions and no push subscriptions: you sign in again and re-enable reminders
on the device you are holding, which is the correct outcome and not a gap.

### 2. Ids, on the way back in

**Remap every id on import, and rewrite the references that point at them.**

Reusing exported ids collides the moment someone imports into an account that
already has rows. So the importer mints new ids and keeps an old-to-new map for
the length of the transaction, rewriting:

- `goals.parentId` — to the newly minted parent, or null if that goal is not in
  the bundle, exactly as `$domain/nesting` would tolerate.
- `goalArchiveWindows.goalId`, `entries.goalId`, `orbitNotes.goalId` — their
  parent goal is required; a row whose goal is missing is dropped, because the
  cascade says it is not a thing without one.
- `asteroids.capturedGoalId` — re-link when that goal is in the bundle,
  otherwise null while **keeping** `resolution: 'captured'` and `resolvedAt`.
  The fact that a rock became a goal survives the goal not being here, which is
  the rule #30's spec already set.

Nesting's own rules — same user, strictly longer cadence, acyclic — are enforced
at write time in `$domain/nesting`, not by the database. An import must run a
bundle through the same checks rather than trusting that a file which claims to
be an export is one.

### 3. What merge means

**Merge adds; it never edits or deletes anything already there.** Replace wipes
the account's own rows first, in one transaction, then imports as if merging
into an empty account.

Two specifics that decide whether a merge is safe to run twice:

- **`entries.clientId` is the dedupe, and it is free.** The unique index on
  `(goalId, clientId)` is what already stops the offline queue, the `online`
  listener and the service worker counting one log three times. Import entries
  with `onConflictDoNothing` on that pair and re-importing the same file into
  the same account adds nothing the second time. Do not replace this with a
  read-then-write check; that is the exact thing the index exists to prevent.
- **An entry with a null `clientId` has nothing to dedupe on.** SQLite counts
  each null as distinct, so those will duplicate on a second merge. Mint a
  deterministic `clientId` for them on the way in — derived from the bundle's
  own row id — so a repeated merge is idempotent for every entry rather than
  most of them.

`orbitNotes` re-import with their **original** `periodKey`, never a recomputed
one: the importing account may have a different week start, and rewriting the
key would silently reassign a note to a period it was never about. This is the
same reasoning as #18's decision 2, and the same reason `periodStart` travels
with it.

### 4. The file, and files that are not it

The envelope carries `schemaVersion` (an integer, starting at 1), `exportedAt`,
and the data. On import:

- **An unknown version is refused, not guessed at.** A newer file than this
  build understands is an error with a plain message, never a best-effort
  partial read.
- **Size is capped** before parsing — this is unauthenticated-shaped input even
  though it arrives authenticated, and `JSON.parse` on an arbitrarily large body
  is a denial of service with extra steps. Pick a cap that fits years of real
  use with room over; state it in the error.
- **Zod validates the whole bundle before a single row is written**, and the
  write runs in one `db.transaction`. A bundle that fails halfway leaves nothing
  behind.

### 5. Dry run

The summary is produced by the **same code path** that does the write, run
against the same validated bundle — counts per table, how many entries would
dedupe away, how many rows would be dropped for a missing goal, and what replace
would delete. A dry run that is a second implementation of the importer is a dry
run that tells you about a program you are not about to run.

### 6. Deleting the account

Irreversible, so: confirm by typing the account's own email address, not by
clicking a red button. The cascade from `users` reaches goals (and through them
archive windows, entries, notes), asteroids, sessions, reset tokens, push
subscriptions and reminder settings. Offer the export on the same screen — the
one moment someone certainly wants their data is just before destroying it.

Deletion signs every device out by construction, since the sessions go with the
user row.

## Shape

- `src/lib/server/transfer/export.ts` — builds the bundle from allowlisted
  columns.
- `src/lib/server/transfer/import.ts` — validates, plans, and applies in a
  transaction; the plan is what the dry run renders.
- `$domain/transfer.ts` — the bundle's Zod schema and the version constant. Pure
  data, so it is testable without a database and the same schema can describe a
  file the browser has not uploaded yet.
- Routes under `/settings/data`: export downloads, import takes a file and shows
  the plan before a second confirming post, delete lives at the bottom.

Ownership is re-checked inside the service functions, as everywhere else.

## Done when

- A full round trip — export, delete the account, re-register, import — restores
  every goal, entry, asteroid and note, and every streak reads the same as it
  did before.
- Importing the same file twice into the same account changes nothing the second
  time.
- The exported file contains no password hash, no session, no reset token and no
  push subscription. There is a test that asserts this by scanning the
  serialised bundle for those column names, so a column added later fails it.
- A bundle with a bad row writes nothing at all, and says which row.
- An export taken before this issue's own schema version exists is either
  imported or refused with a clear message — never half-read.
- Account deletion leaves no orphaned rows, in any table.

## As built

Three things the Decisions above left to the build session, recorded here so the
next reader does not have to infer them from the code.

**The cap is 16 MB.** An entry serialises to roughly 200 bytes — two ids, two
timestamps, an amount and usually a null note — so the cap holds on the order of
80,000 entries: ten logs every day for more than twenty years, with everything
else costing a rounding error beside that. It is `MAX_BUNDLE_BYTES` in
`$domain/transfer` and the number appears in the refusal. The uploaded file's
byte length is checked in the route before it is read, and the decoded string
again in `readBundle()`.

Raising it has a second half: `BODY_SIZE_LIMIT` on the Node adapter, and any
reverse proxy's own limit, must sit above it, or an oversized import is a bare
413 with no message rather than Nova saying what the cap is. `compose.yaml`,
`.env.example` and `DEPLOYMENT.md` were moved from 512K to 17M together.

**Ids are always minted, never reused — and minting is deterministic.** Keeping
an exported id when the importing account happens to own it would be a cheap way
to make a repeat import a no-op, but it would also let a file's claim about a
goal's tier land on an edge pointing at a real goal with a different one. So
every goal that is written is a new row whose parent is another goal from the
same file, which makes the file's own graph the whole of what `parentProblem()`
has to check. Idempotency comes from the id being a SHA-256 of
`(account, table, the file's own row id)` instead: the same file mints the same
ids the second time, so every row collides with the one already there and the
merge adds nothing. The cost is that importing a file into the account that
exported it, without deleting anything first, adds a second copy — which is what
"merge adds, and never edits" means.

**Merge leaves the profile alone; replace restores it.** Merge does not touch
the display name, time zone, week start or preferences, for the same reason it
does not touch any other row that is already there. Replace restores all four,
because a period boundary is drawn in the account's own zone and a restored
record whose weeks start on a different day is not the record that was exported.
Neither mode writes the email address or the password: the address is the
account's identity, and the file's may belong to somebody else. A time zone in a
file is validated against `Intl` like any other field, since a zone no runtime
recognises is not a bad field but an account whose periods cannot be computed.
