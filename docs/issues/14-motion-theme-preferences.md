---
title: Motion and theme preferences
labels: [enhancement, a11y]
milestone: 'M2 — The fun part'
---

Animation currently follows the OS `prefers-reduced-motion` setting and nothing
else. Some people want the starfield still but the orbits animated, or a calmer
palette at night, without changing a system-wide setting.

**Build** a preferences section covering:

- Motion: full, reduced, or none. Defaults to the OS setting.
- Starfield density, including off.
- A lighter high-contrast palette for bright sunlight, which is a genuine problem
  for a dark space theme on a phone outdoors.

Store on the user row so preferences follow the account across devices, and apply
them as data attributes on `<html>` so CSS does the work.

**Done when**

- Every preference takes effect without a reload and persists across devices.
- The OS setting is still respected as the default.
