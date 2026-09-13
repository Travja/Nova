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

**Password reset.** There is no route back in from a forgotten password. A
single-use, short-lived, hashed token in its own table, following the same
pattern as sessions.

This needs outbound email, which is the first external dependency Nova takes on.
The decision, made once the error-report sink had set the precedent: SMTP
configured by environment variables, off unless `SMTP_HOST` is set, pointed at
whatever server the operator already has — no hosted mail API, no account to
sign up for. An instance that configures nothing sends nothing, and an operator
with a shell mints a reset link with `pnpm reset:password`, so a single-person
instance never needs mail at all.

**Session visibility.** Sessions last 30 days and cannot be revoked from the UI. Add a
list of active sessions with a revoke action, and revoke all sessions on password
change.

**Done when**

- Repeated failures are throttled and the throttle is tested.
- A password can be reset end to end.
- A user can see and revoke their own sessions.
