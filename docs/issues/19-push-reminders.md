---
title: Reminder notifications via Web Push
labels: [enhancement, pwa, backend]
milestone: 'M4 — Reach and operations'
---

An installed PWA that never speaks up is easy to forget, and forgetting is the
failure mode this app exists to prevent.

**Build** opt-in reminders:

- Web Push with VAPID keys, subscriptions stored per device.
- Rules worth sending: a Satellite unclosed late in the day, a period ending
  within a day and well short, a streak about to break.
- A quiet-hours window and a hard cap on frequency. One useful nudge a day beats
  five ignored ones.
- Scheduling runs server-side against each user's own time zone, which the profile
  already stores.

iOS only delivers push to a PWA that has been added to the home screen, so the
install guidance issue is a prerequisite in practice.

**Done when**

- Reminders arrive on Android and on an installed iOS PWA.
- Quiet hours are respected and opting out is one tap.
- No reminder fires for a goal that has already closed its orbit.
