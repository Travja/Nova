---
title: 'Mobile density: tighten the baseline and add a compact option'
labels: [enhancement, frontend]
milestone: 'M1 — Daily driver'
---

Nova is meant to live on a phone, and since the Today view became the landing
page on narrow screens, the amount of it you can see at once is the thing that
decides whether it is pleasant to use. Right now a 390px screen shows roughly two
goal cards. The scaffold's spacing and type were chosen desktop-first and never
revisited.

Two parts, in this order.

## Tighten the baseline

Not a toggle — the default should simply be denser. The scaffold set card padding,
panel radii, dial sizes, stat rows and chip heights by eye on a wide screen. Go
through them against a 390px viewport and take out the slack: card padding, the
gap between a card's dial and its body, the stats row, section headers, and the
type scale for secondary text.

Do it as **density tokens in `src/lib/styles/app.css`**, not as per-component
overrides. One set of custom properties that components consume is the difference
between this being adjustable later and being a hundred scattered magic numbers.

## Then a compact option

For people who want more on screen still: smaller dials, the stats row reduced or
hidden, tighter rows.

Ride on #14's preference mechanism rather than inventing a second one — stored on
the user row, applied as a data attribute on `<html>`, so it follows the account
across devices. If #14 has not landed, coordinate with it rather than racing it.

## The hard floor

**Touch targets stay at 44px minimum, in every density.** Compact means more
information per screen, never a button you have to aim at. The quick-log chips
are the ones at risk — they are the most-tapped control in the app and they are
already close to the line.

Check against #7's list while you are in here; contrast for `--text-dim` was
already flagged as borderline and shrinking text will not help it.

## Done when

- A 390px screen shows meaningfully more at the default density than it does now.
- Compact is a stored preference that follows the account, not a per-device one.
- No interactive target anywhere falls below 44px in any density.
- The density scale is a set of tokens, readable in one place.
