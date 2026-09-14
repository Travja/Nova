---
title: Accessibility pass on the orbit visuals
labels: [a11y, frontend]
milestone: 'M1 — Daily driver'
---

The orbit dial carries the most important information on the screen and is
currently `role="presentation"` with the numbers alongside it. Cards expose a
progress bar, but the large dials do not, and the orbit history strip announces
raw period keys like `week:2026-W37`.

Everything this pass was waiting on has now landed — the tier bodies, the
celebration, the mascot, the density work — so there is nothing left to redo
around. It is also the last open item in M1.

**Scale note:** this spec was first written against an 8-route app. Nova now has
14 routes and four display preferences. The list below is current as of the
offline-logging and preferences work; check it against the tree before starting,
because it has drifted twice already.

## The core work

- Give the dial an accessible name and value, or mark it decorative and guarantee
  an equivalent text node adjacent to it. Pick one and apply it consistently
  across every size it renders at: 24px in the history strip, on a goal card, in
  the goal form preview, and on the detail page. `TierBody` now varies what it
  draws by size, which the accessible name should not vary with.
- Replace period keys in labels with readable dates ("week of 7 September").
- Check focus order and visible focus through every form, including the radio
  groups in the goal form, which hide their inputs.
- **Dormant orbits must not be distinguished by colour alone.** A period the goal
  spent archived carries an `Orbit.dormant` flag and has to read as dormant to a
  screen reader too, not just as an empty ring.

## Surfaces to cover

Every route: `/`, `/today`, `/goals/new`, `/goals/[id]`, `/goals/[id]/edit`,
`/goals/archived`, `/share`, `/settings`, `/settings/security`, `/login`,
`/register`, `/forgot`, `/reset`.

The components that carry interaction or state, and what specifically to check:

- **`OfflineQueue`** — a queued entry must be announced, not just tinted, and the
  flush that confirms or fails it has to reach a screen reader. This is the newest
  surface and the one most likely to have been done by eye.
- **`QuickAdd`** — the floating button is a link. It must sit in the focus order
  somewhere sensible and carry a real name, not an icon alone.
- **`UpdatePrompt`** — a status region that appears without the user acting. Check
  it announces once rather than on every render, and that dismissing it returns
  focus somewhere reasonable.
- **`GoalOrderList`** — reordering from the keyboard must announce the move via
  `aria-live`, not only reflect it visually.
- **`GoalSheet` / `GoalRow`** — the compact layouts. Everything true of a card has
  to stay true of a row.
- **`/today`'s disclosure** — the collapsible "flying steady" fold needs real
  disclosure semantics with its state announced.
- **`/settings/security`** — revoking a session removes the row the user is
  focused on. Focus has to land somewhere deliberate afterwards.
- **`IosInstallHint`** and **`Mascot`** — decorative or informative? Decide, and
  mark them accordingly rather than leaving it ambiguous.

## Preferences multiply the matrix

There are four now: `density`, `motion`, `starfield`, `contrast`. The pass has to
hold in the combinations that matter, not just the defaults —
`density=compact`, `motion=reduced` and `motion=none`, and `contrast=high`.

On contrast specifically: #14 shipped a high-contrast palette and claimed its
ratios. **Verify them rather than trusting them**, and check the default palette
too — `--text-dim` on `--space-surface` was flagged as close to the 4.5:1 line
before the density pass shrank secondary text.

Under `motion: none` and `motion: reduced`, confirm that position alone still
carries the orbit's meaning, since the body stops moving.

## Done when

- A screen reader can read every goal's progress without seeing the dial.
- axe reports no violations on every route listed above.
- Every interactive flow added since the scaffold — reorder, revoke, disclosure,
  reset, quick-add, offline queue, preferences — is completable from the keyboard
  alone.
- The contrast figures are measured and written down, for both palettes.
