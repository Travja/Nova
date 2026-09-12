---
title: 'Harden sign-in: rate limiting, password reset, session list'
labels: [security, backend]
milestone: 'M1 — Daily driver'
---

Authentication is deliberately small — hashed session tokens, Argon2id passwords,
a vague failure message — but three gaps matter before this is on the public
internet.

**Rate limiting.** Nothing slows down repeated sign-in attempts. Add a per-account
and per-IP limiter with exponential backoff. In-process is fine for a single
container; keep the interface narrow so it can move to the database or Redis.

**Password reset.** There is no route back in from a forgotten password. This needs
outbound email, which is the first external dependency Nova would take on — worth
a decision before building. A single-use, short-lived, hashed token in its own
table, following the same pattern as sessions.

**Session visibility.** Sessions last 30 days and cannot be revoked from the UI. Add a
list of active sessions with a revoke action, and revoke all sessions on password
change.

**Done when**

- Repeated failures are throttled and the throttle is tested.
- A password can be reset end to end.
- A user can see and revoke their own sessions.
