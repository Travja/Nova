---
title: An entry can say "saved on this device" before it is
labels: [bug, frontend, pwa]
milestone: 'M1 — Daily driver'
---

Logging offline reports success before the entry has reached IndexedDB, so a
reload in the window between the two loses it. Found while working on #7, which
is why it is written up rather than fixed there.

## What happens

`logOrQueue` in `src/lib/offline/enhance.ts` queues like this:

```ts
const queue = (entry: QueuedEntry) => {
	// Not awaited: the dial moves on the next tick from the queue's own
	// state, while the write and the flush attempt carry on behind it.
	void enqueue(entry);
	options.onbusy?.(false);
	options.onqueued?.(entry);
};
```

`enqueue` puts the entry in `items` synchronously — which is what moves the dial,
and the reason for not awaiting — and only then `await writeStored(entry)`. But
`onqueued` fires on the same tick, and `onqueued` is what paints **"Saved on this
device — it will sync when you are back online"** on `/goals/[id]`, in `GoalSheet`
and on `/share`.

So the app makes a durability promise on the tick the entry enters memory, and
keeps it some time later. `enqueue`'s own doc comment describes the intended
order — _"Written down before anything else: a log that is only in memory does
not survive the reload that a flaky connection tends to come with"_ — and the
call site is what breaks it.

The window is small, and it is open at exactly the wrong moment: a flaky
connection is when people reload, and offline logging exists for flaky
connections. It is also when `durable` is still `true` by default, so the browser
that has _refused_ storage says "saved on this device" too, until the write comes
back and the wording changes underneath.

## How it shows up

`e2e/offline-logging.spec.ts` → _"an entry logged offline lands in the orbit it
happened in, not the one it flushed in"_ fails about **one run in four**. It logs
offline, waits for the "it will sync" copy, reloads, and expects the orbit to
still read 100%; on a bad run the strip reads 0% for the whole 5s poll, because
`readStored()` found nothing to restore.

This is not new and not a test problem — it reproduces at the same rate on `main`
with the assertion untouched (confirmed while rewriting that test for #7).
`retries: 1` in CI hides it most days.

## Build

The fix is ordering, not removing the optimism. The dial should still move on the
next tick — that is the whole point of the unawaited call — but the _sentence
that promises durability_ should wait for the write:

- Have `enqueue` resolve with whether the entry was stored, and let `onqueued`
  run from that resolution rather than from the same tick. The optimistic state
  update stays synchronous.
- Or give `onqueued` a second beat: paint "Logged" immediately and upgrade to
  "Saved on this device" once `writeStored` confirms, dropping to "this browser
  will not keep it if you reload" when it does not. That is a wording change as
  much as a code one, and it is the honest version — the queue already tracks
  `durable` for precisely this case and currently reports it a moment late.

Either way, do not make the whole submit await IndexedDB before the dial moves.
An entry that is visibly slow to register is its own bug.

Worth checking while in here: `flush()` is called from inside `enqueue` after the
write, and offline it sits on a fetch for up to `ATTEMPT_TIMEOUT_MS` (15s). Make
sure whatever resolves `onqueued` is not waiting on that as well.

## Done when

- Nothing tells the user an entry is saved on this device until it is.
- A browser that refuses storage says so on the first paint rather than a moment
  later.
- The dial still moves on the next tick, with no visible delay on logging.
- The offline-logging test passes on repeat runs rather than three times in four.
  `--repeat-each=10` on that one test is the check.
