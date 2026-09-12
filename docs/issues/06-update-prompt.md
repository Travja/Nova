---
title: Tell the user when a new version is ready
labels: [enhancement, pwa, good-first-issue]
milestone: 'M1 — Daily driver'
---

The service worker is registered with `autoUpdate`, so a new build takes over
silently on the next load. That is fine until a release changes the shape of the
data a page is holding, and it gives no signal that an update happened at all.

**Build** a small, non-modal prompt: "Nova has been updated — reload to get it."

Switch `registerType` to `prompt`, use the `virtual:pwa-register/svelte` helper
(or listen for `updatefound` directly), and let the user dismiss it. Reloading is
their call, not the app's, unless the update is a security fix.

**Done when**

- A deployed update surfaces a dismissible prompt rather than a silent swap.
- Dismissing it does not re-nag on every route change.
