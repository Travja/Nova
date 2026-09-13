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

**Settled:** #14 had not landed and was not being worked on, so this built the
mechanism it describes rather than waiting for it — a preferences concept, not a
`compactMode` column. `$domain/preferences` declares each preference with its
values and its default; the set is one JSON blob on the user row; a hook stamps
it onto `<html>` so CSS does the work and the first paint is already right.
#14's motion, starfield and palette settings are entries in that table plus
blocks in `app.css` — no rework, and the settings form grows the controls on its
own.

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

## One statement of progress, not four

A card said the same thing four ways: the dial's arc, the caption under it
(`5 pages / 20 pages`), a meter bar, and the status line (`15 pages left
today`). The arc and the status line survive — the dial _is_ the progress bar,
which is the whole point of it, and the status line is the one that says what
to do about it. The caption and the meter go; the meter keeps its
`role="progressbar"` for anyone the dial is presentational to.

That also squares the card up. The dial column was 132px of ring plus a
two-line caption against about 90px of text, which read lopsided however it was
aligned; without the caption the two columns are close enough to sit centred
against each other. `More…` goes too on a phone, where three chips carrying a
unit fill the row and it wrapped onto a second 44px row of its own — for a
third link to the page the title and the dial both already open.

## Compact is a different shape, not the same one squeezed

The first pass at compact was the card with less padding round it, and it bought
about thirty pixels a goal — nowhere near enough to change what you can take in
at a glance, because the card's _shape_ was the floor, not its spacing.

Compact now draws a goal as a row: the ring, the title, and what is left, at
roughly a quarter of the height. The quick-log the card carried moves into a
sheet the row opens, which is the same `GoalCard` the default density draws —
one card in the app, and this is a second way of getting at it. Logging from the
sheet posts to the same action and never leaves the list.

Measured on Today at 390px with seven goals: **246px per goal down to 66px**, and
one goal fully on screen up to six.

`<dialog>` carries the sheet, so the focus trap, the escape key and the
inertness of the page behind it are the platform's rather than ours. The row is
an ordinary link to the goal underneath the enhancement, so no JavaScript and no
`<dialog>` still lands somewhere sensible. The pilot's column narrows in compact
too — it was taking a fifth of the screen the rows were trying to fill.

This is the one place density is a branch in JavaScript rather than a token. A
shape change cannot be a custom property, and the preference is already on the
page data that renders it, so the server and the client never disagree about it.

## What the floor cost

Measured, not eyeballed — 178 targets at 390px in both densities, and five kinds
were under the line. The chips were the worst: 36px on a card, 40px on the detail
page. They went **up** to 44px, against the grain of the rest of this. Nav items, the `Today`
disclosures, the entry-row actions, the pilot's dismiss and the colour swatches
(34px) were under it too and went up the same way. Two were free: a goal card's
title link was a 20px-tall link sitting on a 46px block, so the link took the
block; the pilot's dismiss lets its hit area overhang copy that is not
interactive. The space came back out of padding, gaps and secondary type — and, on
a phone, out of a goal card's layout: dial beside body rather than stacked above
it, with the quick-log spanning the card underneath.
