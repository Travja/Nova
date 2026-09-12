---
title: Accessibility pass on the orbit visuals
labels: [a11y, frontend]
milestone: 'M1 — Daily driver'
---

The orbit dial carries the most important information on the screen and is
currently `role="presentation"` with the numbers alongside it. Cards expose a
progress bar, but the detail page's large dial does not, and the orbit history
strip announces raw period keys like `week:2026-W37`.

**Work**

- Give the dial an accessible name and value, or mark it decorative and guarantee
  an equivalent text node adjacent to it. Pick one and apply it consistently.
- Replace period keys in labels with readable dates ("week of 7 September").
- Check focus order and visible focus through every form, including the radio
  groups in the goal form, which currently hide their inputs.
- Verify contrast for `--text-dim` on `--space-surface`; several labels are close
  to the 4.5:1 line.
- Confirm the whole app is usable with `prefers-reduced-motion: reduce`, where
  the orbiting body stops moving and position alone carries the meaning.

**Done when**

- A screen reader can read every goal's progress without seeing the dial.
- axe reports no violations on the dashboard, detail and form pages.
