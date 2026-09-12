---
title: 'Deployment guide: reverse proxy, TLS and updates'
labels: [ops, documentation, good-first-issue]
milestone: 'M4 — Reach and operations'
---

The README gets someone to `docker compose up`. Everything after that — the part
where a PWA needs HTTPS and `ORIGIN` has to match exactly — is left as an
exercise.

**Write** a guide covering:

- A Caddy and an nginx example with automatic TLS, including the headers the Node
  adapter needs (`X-Forwarded-For`, `X-Forwarded-Proto`) and the matching
  `ADDRESS_HEADER` and `PROTOCOL_HEADER` settings.
- Why `ORIGIN` must match the browsed URL, with the symptom when it does not:
  form posts rejected as cross-site.
- Upgrading: pull, rebuild, restart, and the fact that migrations run on start.
- Where the data lives and what to back up.

**Done when**

- Following the guide from a clean host produces a working HTTPS install.
- The common `ORIGIN` failure is documented with its exact error.
