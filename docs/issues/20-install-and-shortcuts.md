---
title: 'PWA polish: shortcuts, share target, install guidance'
labels: [enhancement, pwa, good-first-issue]
milestone: 'M4 — Reach and operations'
---

The manifest covers the basics — name, icons, standalone display, theme colour —
and stops there.

**Add**

- Manifest `shortcuts` for "Log progress" and "New goal", so a long-press on the
  home screen icon goes straight to the action.
- A share target, so sharing text into Nova drafts an entry note.
- `screenshots` in the manifest, which is what makes the richer install prompt
  appear on Android.
- Install guidance for iOS, where there is no prompt and the flow is Share then
  "Add to Home Screen". Show it only in mobile Safari, and only when not already
  installed.

**Done when**

- Shortcuts appear on a long-press on Android.
- iOS users get accurate instructions rather than a prompt that never fires.
