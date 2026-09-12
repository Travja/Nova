---
title: 'Nested orbits: let small goals feed a bigger one'
labels: [enhancement, needs-design]
milestone: 'M2 — The fun part'
---

The tier ladder is a nesting metaphor — a satellite orbits a planet, a planet
orbits a star — but the tiers are independent today. Making the nesting real is
the most interesting mechanic available.

**The idea.** A goal can declare a parent in a higher tier. Progress flows upward:
four closed weekly Planet orbits close the monthly Star System orbit above them.
"Exercise 3× a week" feeds "12 workouts this month" without logging anything
twice.

**Decisions to make first**

- Does the parent count _closed child orbits_, or does it sum the child's raw
  amounts? Both are defensible and they behave very differently when a child
  overshoots.
- Can a parent also be logged against directly, or is it purely derived?
- What happens when a child is archived or its target changes mid-period?
- How deep can nesting go — one level, or the full ladder?

**Sketch**

`goals.parentId` plus a `contribution` mode on the child. `snapshotGoal()` grows a
variant that resolves a tree, which is straightforward because the domain layer is
pure. The visual payoff is real: a child body orbiting its parent on the dial.

Start with a written proposal on this issue before writing code.
