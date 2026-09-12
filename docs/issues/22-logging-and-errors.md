---
title: Structured logging and error reporting
labels: [ops, backend]
milestone: 'M4 — Reach and operations'
---

The server logs nothing but the adapter's start-up line, and a failed form action
surfaces as SvelteKit's generic error page. Debugging a self-hosted instance from
a user's description alone is guesswork.

**Build**

- Structured request logging: method, path, status, duration, user id when signed
  in. Never log the session token or anything from a password field.
- A `handleError` hook that assigns each error an id, logs the detail, and shows
  the user the id without the stack.
- A health endpoint that checks the database, for the Docker healthcheck to use
  instead of fetching the home page.
- Optional error reporting to a self-hostable sink, off by default. A self-hosted
  app should not phone home unless asked.

**Done when**

- An error shown to a user can be found in the logs by its id.
- Logs contain no secrets.
