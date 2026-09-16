---
title: '"Running out of time" is on all day for daily goals'
labels: [bug, frontend]
milestone: 'M3 — Insight'
---

`CLOSING_WINDOW_MS` is a flat 24 hours, and its comment states the consequence as
if it were the intent:

> A satellite's period is never longer than the window, so every unclosed
> satellite qualifies; everything larger only surfaces as its deadline nears.

So a daily goal is "running out of time" from one minute past midnight. The
Today view's headline — _"N orbits need attention — running out of time"_ — is
therefore on all day, every day, for every satellite. A warning that never turns
off is not a warning, it is the background, and it devalues the same headline for
the goals that genuinely are close to their deadline.

Reported from real use: "the notification stating that basically the day only has
so much time left and goals still aren't met is being shown all day."

## Build

Make the window proportional to the period instead of fixed, with a cap:

```ts
const CLOSING_FRACTION = 0.25;
const CLOSING_CAP_MS = 14 * 24 * 60 * 60 * 1000;

export function closingWindowFor(period: Period): number {
	const span = period.end.getTime() - period.start.getTime();
	return Math.min(span * CLOSING_FRACTION, CLOSING_CAP_MS);
}
```

Which gives: a day → the last 6 hours; a week → the last 42; a 30-day month →
the last 7½ days; a quarter and a year → the last 14, capped.

The cap matters at the long end: a quarter of a year is three months, and a
yearly goal is not running out of time in October. Falling behind over a long
horizon is what `isBehindPace` already covers; `isClosing` should only be about
the deadline being close.

Deriving it from the period's own length means a 23- or 25-hour DST day scales
with it rather than needing a special case.

`isClosing` is only called from `focusForToday` and the tests, so the blast
radius is small.

## The part that makes this more than a constant change

**`e2e/today-view.spec.ts` will start failing outside the last quarter of the
day, and that is the fix working.**

`/today/+page.server.ts` computes `now` with `new Date()` on the **server**, and
that spec does not control the clock. Today every fresh satellite is `closing` at
every hour, which accidentally made the spec deterministic. Once the window
shrinks, "2 orbits need attention" only holds between roughly 18:00 and midnight
in the test user's zone.

There is no way to seed around it: nothing is legitimately at risk at 00:01, and
`isBehindPace` has a grace period precisely so a new goal is not judged. The
product is correctly time-dependent, so **the test has to control time.**

A `dev`-gated clock override is the obvious seam — the `app` Playwright project
runs against the dev server, so `dev` is true there, while a production build
ignores it entirely and it is not a hole. Whatever shape it takes, it is the same
seam **#19 needs** to test "a satellite unclosed late in the day", so the two are
worth doing together or in that order.

## Done when

- A daily goal is not flagged as running out of time until its last quarter.
- A yearly goal is not flagged in October.
- The window is derived from the period, including across a DST day.
- `today-view.spec.ts` passes at any hour of the day, because it pins the clock
  rather than because the window is wide enough to always be true.
