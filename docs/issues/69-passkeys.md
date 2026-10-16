---
title: 'Passkeys: sign in with Face ID, Touch ID or a security key'
labels: [enhancement, security, backend, frontend]
milestone: 'M5 — The long haul'
---

# 69 — Passkeys

Nova installs as a PWA, so signing in is typing an email and password on a
phone keyboard. A passkey signs in with the phone's own unlock, can't be phished
onto another domain, and leaves nothing for a breach to reuse. **Passwords
stay:** they're the recovery path (#8's reset by email), and some people will
never use a passkey.

## Approach

- **Libraries:** `@simplewebauthn/server` and `@simplewebauthn/browser`. Don't
  write WebAuthn parsing by hand. The server half lives in
  `src/lib/server/auth/passkeys.ts`, next to `session.ts` and `password.ts`.
- **Storage:** a `passkeys` table:
  - the credential id;
  - `user_id`, with `on delete cascade`;
  - the public key;
  - the signature counter;
  - transports;
  - a name, defaulting to `describeDevice()` of the user agent that registered
    it;
  - `created_at` and `last_used_at`.
- **Challenges:** single-use and short-lived, about five minutes, held on the
  server. Use a small table, or a signed, `httpOnly` cookie bound to the
  ceremony. Never accept a challenge twice.
- **Relying party:** the RP ID is the hostname of `ORIGIN`, and the expected
  origin is `ORIGIN` itself, read through `readOrigin()`. `DEPLOYMENT.md` says
  that moving Nova to another domain leaves existing passkeys unusable. Passwords
  still work, and users add new passkeys.

## Flows

**Adding a passkey,** under Settings → Security, next to the session list:

- Adding one needs the password again, or a session signed in within the last
  ten minutes. Otherwise a stolen session could plant an attacker's passkey and
  keep access after the session is revoked. Removing one has the same guard.
- Passkeys can be listed, renamed and removed. The list shows where each was
  created and when it was last used.

**Signing in:**

- The login page gets a "Sign in with a passkey" button.
- The email field gets `autocomplete="username webauthn"`, so browsers that
  support it offer passkeys from autofill (conditional mediation).
- A successful passkey sign-in creates a session exactly as a password does,
  with `createSession()`. Everything after that is unchanged.

**Things that must not change, with tests:**

- The login throttle counts failed passkey assertions per address, as it does
  failed passwords.
- Changing the password, resetting it, or signing out other sessions leaves
  passkeys alone.
- Deleting the account removes them, through the cascade.
- Export (#17) never includes them. The transfer allowlist already excludes
  credentials; add a test that names this table.
- An unknown credential id, a wrong origin, a replayed challenge, or a counter
  that goes backwards on a credential that keeps one, each fails with the same
  generic message.

## Testing

Chromium has a virtual authenticator through CDP
(`WebAuthn.addVirtualAuthenticator`), and Playwright reaches it with
`page.context().newCDPSession(page)`. The journey:

1. register an account;
2. add a passkey;
3. sign out;
4. sign in with the passkey;
5. remove it;
6. check the passkey no longer signs in.

It's security-sensitive, so build it on Opus and run `/security-review` on the
diff before opening the PR.

## Not in scope

- Passkey-only accounts, with no password at all. The password is the recovery
  path until something better exists.
- Two-factor authentication with TOTP codes. A passkey is already stronger.

## Done when

- A passkey can be added, used to sign in, renamed and removed, from a phone and
  from a desktop browser.
- Adding or removing one needs a recent sign-in.
- Every rule under "Things that must not change" has a test.
- The CDP virtual-authenticator journey passes, and `DEPLOYMENT.md` explains the
  domain binding.
- `pnpm lint && pnpm check && pnpm test && pnpm e2e` pass.
