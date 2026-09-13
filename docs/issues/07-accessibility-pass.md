---
title: Accessibility pass on the orbit visuals
labels: [a11y, frontend]
milestone: 'M1 — Daily driver'
---

The orbit dial carries the most important information on the screen and is
currently `role="presentation"` with the numbers alongside it. Cards expose a
progress bar, but the large dials do not, and the orbit history strip announces
raw period keys like `week:2026-W37`.

**Do this after #10 and #13.** Those two redraw the bodies and the mascot, so a
pass done first would be a pass done twice. The one part that does not depend on
them — period labels, focus order, contrast — can be pulled forward if you want
the win sooner.

**Work**

- Give the dial an accessible name and value, or mark it decorative and guarantee
  an equivalent text node adjacent to it. Pick one and apply it consistently
  across all four sizes it now renders at: 24px in the history strip, 168px on a
  goal card, ~190px in the goal form preview, and ~230px on the detail page.
- Replace period keys in labels with readable dates ("week of 7 September").
- Check focus order and visible focus through every form, including the radio
  groups in the goal form, which hide their inputs.
- Verify contrast for `--text-dim` on `--space-surface`; several labels are close
  to the 4.5:1 line.
- Confirm the whole app is usable with `prefers-reduced-motion: reduce`, where
  the orbiting body stops moving and position alone carries the meaning.
- **Dormant orbits must not be distinguished by colour alone.** A period the goal
  spent archived carries an `Orbit.dormant` flag and has to read as dormant to a
  screen reader too, not just as an empty ring.

**Surfaces added since this was written**

The app has grown from 8 routes to 13. All of these need the same pass:

- `/today` — urgency grouping, the tier badges, and the collapsible "flying
  steady" section. A disclosure needs real semantics and its state announced.
- `/goals/archived` — dials rendered in a restored/archived context.
- Goal reordering — `GoalOrderList` moves items from the keyboard. Confirm the
  move is announced (`aria-live`), not just visually reflected.
- `/settings/security` — the session list, where revoking a row removes it from
  under the user's focus. Focus has to land somewhere sensible afterwards.
- `/forgot` and `/reset` — error and success states that a screen reader has to
  reach, including the deliberately identical response for an unknown address.

**Done when**

- A screen reader can read every goal's progress without seeing the dial.
- axe reports no violations on the dashboard, Today, detail, archived, settings,
  security and the auth forms.
- Every interactive flow added since the scaffold — reorder, revoke, disclosure,
  reset — is completable from the keyboard alone.
