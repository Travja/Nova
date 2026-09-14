---
title: A reconnect keeps the backoff it earned while offline
labels: [bug, pwa]
milestone: 'M1 — Daily driver'
---

`flush(true)` abandons an attempt in flight when connectivity returns, on the
stated grounds that "that attempt was made against a network that no longer
exists." The backoff counter was earned against that same dead network and is
kept.

`retries` only resets when a response actually arrives (`send()`, after the
`fetch` resolves). An attempt that is aborted — offline, or cut off by a route
handler — leaves the counter where it was. So the first flush after `online`
inherits the offline attempt's failures, and if it does not immediately succeed,
`scheduleRetry()` books `RETRY_STEPS_MS[1]` — **5 seconds** — rather than the
2 seconds a fresh reconnect would get.

## Why this shows up as a flake

`e2e/offline-logging.spec.ts` → _"announces what the queue is doing, for anyone
not looking at it"_ fails intermittently, with the live region stuck on
"Saved on this device. 1 entry waiting to sync." while the assertion waits for
"1 entry synced."

Measured by the #12 session after #43 merged, running the whole `offline`
project 16 times per branch:

- `main` @ 96374a9: 1 failure / 16
- PR #42 @ 1222f19: 2 failures / 16

Same test, comparable rate, both branches — residual on `main`, not introduced by
#12. #43 did fix two sibling symptoms (the durability wording, and "the queue is
heard twice when it happens twice", now 16/16).

**The proposed mechanism, from reading the code rather than from a reproduction:**
`goOnline()` unroutes and then calls `setOffline(false)` as two separate CDP
round-trips. If `online` fires and the flush starts its fetch before the unroute
has taken effect, that attempt is aborted too — and with `retries` already at 1
from the offline attempt, the next try is booked 5 s out. Playwright's default
`expect` timeout is also 5 s, so the test is racing the backoff. That fits a
~6–12% failure rate on both branches better than anything else in this path.

This has **not** been reproduced under instrumentation. Confirm it before fixing
— if the counter is not the cause, the diagnosis below is wrong too.

**Confirmed.** Logging `retries` and the delay `scheduleRetry()` picks, and
running the `offline` project until "announces what the queue is doing" failed,
showed exactly this: the offline attempt failed with `retries=0`, booking a 2 s
retry and leaving `retries=1`. `online` then fired `flush(true)`, and that
attempt _also_ failed — the unroute race described above — inheriting
`retries=1` and booking the next attempt at `RETRY_STEPS_MS[1]`, 5000 ms. The
live region was still showing "1 entry waiting to sync." when the test's 5 s
`expect` timed out; the entry synced roughly five seconds later, when the
booked retry finally landed.

## Why it is a product bug and not only a test artifact

A phone that comes out of a lift, or off a captive portal, has usually failed
several attempts on the way. Under the current rule its first real chance to sync
is booked 5, 15 or 60 seconds after the network returns, purely because of
failures against a network that no longer exists. The user is looking at the app
at exactly that moment, and it looks like nothing is happening.

`flush(true)` already encodes the right principle for the in-flight attempt. The
backoff should follow the same reasoning.

## Build

Reset `retries` to 0 when connectivity returns, rather than inside `flush`
itself, so a focus-triggered flush during a genuine outage still backs off
properly.

`startQueue()` binds the same handler to both `online` and `focus`:

```ts
const onOnline = () => flush(true);
window.addEventListener('online', onOnline);
window.addEventListener('focus', onOnline);
```

Resetting `retries` inside that shared handler would reset it on every focus
too — exactly the case this is meant to protect. Split it: a real
connectivity change (`online`) resets `retries` and restarts the attempt;
`focus` keeps restarting the attempt without resetting the backoff.

Then decide separately whether the test should assert with a timeout above the
first backoff step, so it is not measuring the constant.

## Done when

- A reconnect gets a fresh backoff; failures accumulated offline do not delay the
  first attempt after the network returns.
- A focus or visibility flush during a real outage still backs off as before.
- The whole `offline` project passes repeatedly — `--repeat-each=16` on the
  project, not on one test. Report before and after counts.
