---
title: Offline logging with a sync queue
labels: [enhancement, pwa]
milestone: 'M1 — Daily driver'
---

The app shell is precached, but logging still needs the network — the quick-log
buttons post a form action. On a phone, the moment you most want to log progress
is often the moment signal is worst.

**Approach**

- Queue entries in IndexedDB when a request fails or `navigator.onLine` is false.
- Compute the resulting orbit optimistically in the browser. This is the reason
  `src/lib/domain/` has no server imports: `snapshotGoal()` runs unchanged there.
- Flush with a Workbox `BackgroundSyncPlugin`, falling back to an `online` plus
  focus listener where background sync is unavailable (Safari).
- Entries carry `occurredAt`, so a delayed flush still lands in the right orbit.
- Give each queued entry a client-generated id and make the insert idempotent, so
  a retry after a partial failure cannot double-count.

**Done when**

- Progress logs while fully offline and survives a reload.
- Reconnecting flushes with no duplicates and nothing lost.
- An entry made offline on Monday and flushed on Wednesday counts toward Monday's
  orbit.
- Queued entries look visibly pending until confirmed.
