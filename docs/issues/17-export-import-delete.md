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

**This restores goals, not accounts.** That is the line, and everything below
follows from it.

**Exported:** `goals` and `asteroids`, plus the rows that are part of a goal
rather than beside it — `entries`, `goalArchiveWindows` and `orbitNotes`.

**Never exported:** anything that describes the account. Not the email
address, the display name, the time zone, the week start, the preferences or
the reminder terms; and not, obviously, the password hash, the sessions, the
reset tokens or the push subscriptions.

| Not in the file                                 | Why                                                      |
| ----------------------------------------------- | -------------------------------------------------------- |
| `users.passwordHash`                            | A credential. Nothing about a restore needs it.          |
| `sessions`                                      | Live bearer tokens — the file would be a set of keys.    |
| `passwordResetTokens`                           | Same, with a shorter fuse.                               |
| `pushSubscriptions`                             | Endpoint plus auth keys: anyone holding them can push.   |
| `reminderSettings`                              | How the account wants to be interrupted, not its record. |
| `users.email`, `displayName`                    | Identifies a person. A file about goals names no one.    |
| `users.timeZone`, `weekStartsOn`, `preferences` | Settings of the account it lands in, not of the goals.   |

An earlier draft of this spec exported the profile and the reminder terms too,
on the theory that an export should be "everything the account owns". That was
the wrong theory. An export is a plaintext file that lands in a Downloads
folder and often gets mailed onwards "to keep safe", and the narrower the file,
the less there is to get wrong: with no account in the shape at all there is no
`users` row to serialise by accident, and the blast radius of a future mistake
in the allowlist is the goal tables, which hold nothing the pilot did not type
into their own goals.

Build the export from an explicit allowlist of columns per table, never
`select *` minus a deny-list, so the next column added is absent by default
rather than present by accident. Better still, do not query the account tables
at all — the strongest guarantee about a column is one the code never reads.

Two consequences worth naming, both of them correct:

- **Periods are recomputed in the importing account's zone.** Entries carry
  absolute instants, so the orbits they fall into are drawn by whatever zone
  and week start the importing account keeps. Importing a file exported by
  somebody on the other side of the world gives you _your_ weeks, which is
  what restoring a goal into your account should mean. Streaks read the same
  as they did whenever the two accounts agree on a zone, which is the ordinary
  case of one person moving their own goals.
- **Devices and settings stay where they are.** Restoring leaves the account
  with its own name, zone, preferences, reminder terms, sign-ins and push
  subscriptions untouched. Nothing about the file can change them.

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
the account's goals and asteroids first, in one transaction, then imports as if
merging into an empty account. Neither mode touches the account itself — there
is nothing in the file that could.

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

**Neither mode touches the account.** An earlier build of this had merge leave
the profile alone and replace restore the display name, zone, week start and
preferences from the file. Decision 1 settled that differently: the file has no
account in it, so there is nothing to restore and nothing to leave alone, and
`ImportPlan` has no field a writer could use to change one. `replace` clears
goals and asteroids only. Nova is, as a result, the same account before and
after an import — only its goals change.
