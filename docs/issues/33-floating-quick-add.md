---
title: Floating quick-add button for the primary action
labels: [enhancement, frontend]
milestone: 'M1 — Daily driver'
---

Creating a goal is the app's primary action and it currently lives in the header,
in a nav row that already carries Today, New goal, the account name and Sign out —
four items that wrap on a phone and sit at the top of the screen, which is the
part of a phone a thumb reaches last.

Move it to a floating button: bottom-right, above the content, one tap to
`/goals/new`.

## Details that decide whether it feels native

- **Sit above the safe area.** `bottom: calc(1rem + env(safe-area-inset-bottom))`,
  or it lands under the home indicator on an iPhone.
- **Do not cover the last row.** Whatever list is on screen needs bottom padding
  equal to the button's footprint, or the final goal card is permanently half
  hidden behind it. The Today view is the one that matters.
- **It is a link, not a button** — it navigates. Keep it in the focus order with
  a real accessible name, not just an icon.
- **Decide what happens to the nav item.** Recommended: drop it from the header on
  narrow screens where the floating button is present, keep it on desktop where
  the header has room and a floating control looks out of place.

## Open question

Whether it should expand into a small menu once asteroids (#30) land — "new goal"
and "new asteroid" are both quick-add actions and a phone has room for exactly one
floating control. A button that grows a menu is a familiar pattern but it turns a
one-tap action into two. Worth deciding when #30 is designed rather than building
for it speculatively now.

## Done when

- Creating a goal is one thumb-reachable tap at 390px.
- The button never obscures the last item of any list.
- It clears the home indicator on an iPhone.
- It is reachable and labelled for a keyboard and a screen reader.
