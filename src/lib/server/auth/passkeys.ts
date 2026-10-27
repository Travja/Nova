import { db } from '$lib/server/db';
import { passkeys, users, webauthnChallenges } from '$lib/server/db/schema';
import { verifyPassword } from '$lib/server/auth/password';
import { sessionSignedInAt } from '$lib/server/auth/session';
import { hashToken, newToken } from '$lib/server/auth/token';
import { describeDevice } from '$lib/server/auth/user-agent';
import { readOrigin } from '$lib/server/mail/config';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { Cookies } from '@sveltejs/kit';
import { and, asc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Passkeys (#69): WebAuthn credentials that sign in instead of the password.
 *
 * Every byte of WebAuthn is parsed and checked by `@simplewebauthn/server`.
 * What lives here is the policy around it, and it lives here rather than in
 * the routes so that no caller can skip any of it:
 *
 * - **The relying party is `ORIGIN`.** The RP ID is its hostname and the only
 *   origin accepted is `ORIGIN` itself, through `readOrigin()`. Nothing is read
 *   from the request's own headers, which whoever sent it wrote.
 * - **Challenges are single use and held here.** The browser gets a random
 *   token in an `httpOnly` cookie; the database holds its SHA-256, the
 *   challenge, and which ceremony it is for. Finishing a ceremony deletes the
 *   row before anything is verified, so a challenge is spent whether the
 *   response was good or not, and a replay finds nothing.
 * - **Adding or removing a passkey needs a recent sign-in.** The password
 *   again, or a session signed in within the last ten minutes. Otherwise a
 *   stolen cookie could plant its own passkey and keep the account after the
 *   session was revoked.
 * - **Every failed sign-in looks the same.** An unknown credential, the wrong
 *   origin, a spent challenge and a counter that went backwards all come back
 *   as `{ ok: false }`, and the route shows one message for all of them.
 */

/** Long enough to find a security key in a drawer, short enough to be worth little if it leaks. */
export const CHALLENGE_LIFETIME_MS = 5 * 60_000;

/** How recent a sign-in has to be to add or remove a passkey without the password. */
export const RECENT_SIGN_IN_MS = 10 * 60_000;

/** The cookie that ties a ceremony to the browser that began it. */
export const CEREMONY_COOKIE = 'nova_webauthn';

/** The only thing a failed passkey sign-in ever says, whatever went wrong. */
export const PASSKEY_SIGN_IN_FAILED =
	'That passkey did not work. Try again, or sign in with your password.';

/** What a user can call a passkey. */
export const PASSKEY_NAME_MAX = 60;

const RP_NAME = 'Nova';

type Purpose = 'register' | 'authenticate';

export interface RelyingParty {
	/** The hostname of `ORIGIN`, which passkeys are bound to for good. */
	id: string;
	/** `ORIGIN`, the only origin a response is accepted from. */
	origin: string;
}

/**
 * Who passkeys belong to, or null when this instance has no `ORIGIN` to bind
 * them to — production without one, where passkeys are simply not offered.
 */
export function relyingParty(env: NodeJS.ProcessEnv = process.env): RelyingParty | null {
	const origin = readOrigin(env);
	if (!origin) return null;
	try {
		const url = new URL(origin);
		return { id: url.hostname, origin: url.origin };
	} catch {
		return null;
	}
}

export function passkeysAvailable(): boolean {
	return relyingParty() !== null;
}

/* -------------------------------------------------------------------------- */
/* Recent sign-in                                                              */
/* -------------------------------------------------------------------------- */

/** Pure, so the window is testable on its own. */
export function isRecentSignIn(signedInAt: Date | null, now: number = Date.now()): boolean {
	if (!signedInAt) return false;
	const age = now - signedInAt.getTime();
	return age >= 0 && age <= RECENT_SIGN_IN_MS;
}

/**
 * Whether this request may change the account's passkeys: the session signed
 * in within the last ten minutes, or the password typed again now.
 */
export async function confirmIdentity(
	userId: string,
	sessionToken: string | null,
	password: string | null,
	now: number = Date.now()
): Promise<boolean> {
	if (await signedInRecently(userId, sessionToken, now)) return true;
	if (!password) return false;

	const [row] = await db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	return row ? verifyPassword(row.passwordHash, password) : false;
}

/** Whether this session is recent enough that the password need not be asked for. */
export async function signedInRecently(
	userId: string,
	sessionToken: string | null,
	now: number = Date.now()
): Promise<boolean> {
	if (!sessionToken) return false;
	return isRecentSignIn(await sessionSignedInAt(userId, sessionToken), now);
}

/* -------------------------------------------------------------------------- */
/* Ceremonies                                                                  */
/* -------------------------------------------------------------------------- */

interface Ceremony {
	challenge: string;
	userId: string | null;
	sessionId: string | null;
}

async function openCeremony(
	purpose: Purpose,
	challenge: string,
	owner: { userId: string; sessionId: string } | null,
	now: number
): Promise<string> {
	// Abandoned ceremonies would otherwise pile up; this is the cheap moment.
	await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date(now)));

	const token = newToken();
	await db.insert(webauthnChallenges).values({
		id: hashToken(token),
		challenge,
		purpose,
		userId: owner?.userId ?? null,
		sessionId: owner?.sessionId ?? null,
		expiresAt: new Date(now + CHALLENGE_LIFETIME_MS),
		createdAt: new Date(now)
	});
	return token;
}

/**
 * Spend a ceremony. The row is deleted in the same statement that reads it,
 * before its challenge is used for anything, so two requests racing with one
 * token cannot both get it.
 */
async function consumeCeremony(
	token: string | null | undefined,
	purpose: Purpose,
	now: number
): Promise<Ceremony | null> {
	if (!token) return null;
	const [row] = await db
		.delete(webauthnChallenges)
		.where(eq(webauthnChallenges.id, hashToken(token)))
		.returning();
	if (!row) return null;
	if (row.purpose !== purpose) return null;
	if (row.expiresAt.getTime() <= now) return null;
	return { challenge: row.challenge, userId: row.userId, sessionId: row.sessionId };
}

export function setCeremonyCookie(cookies: Cookies, token: string): void {
	cookies.set(CEREMONY_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: process.env.NODE_ENV === 'production',
		maxAge: CHALLENGE_LIFETIME_MS / 1000
	});
}

/** The ceremony token, removed from the browser as it is read: it is single use either way. */
export function takeCeremonyCookie(cookies: Cookies): string | null {
	const token = cookies.get(CEREMONY_COOKIE) ?? null;
	if (token) cookies.delete(CEREMONY_COOKIE, { path: '/' });
	return token;
}

/* -------------------------------------------------------------------------- */
/* What the browser sends back                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The outline of a response, checked before the library sees it. This is not
 * WebAuthn parsing — every field is still an opaque base64url string here —
 * only a guard so that a form field holding something else entirely is turned
 * away as a failure rather than thrown on.
 */
const base64url = z
	.string()
	.max(16_384)
	.regex(/^[A-Za-z0-9_-]*$/);

const registrationResponseSchema = z.object({
	id: base64url.min(1).max(1_024),
	rawId: base64url.min(1).max(1_024),
	type: z.literal('public-key'),
	authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
	clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
	response: z.object({
		clientDataJSON: base64url,
		attestationObject: base64url,
		authenticatorData: base64url.optional(),
		transports: z.array(z.string().max(32)).max(8).optional(),
		publicKeyAlgorithm: z.number().int().optional(),
		publicKey: base64url.optional()
	})
});

const authenticationResponseSchema = z.object({
	id: base64url.min(1).max(1_024),
	rawId: base64url.min(1).max(1_024),
	type: z.literal('public-key'),
	authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
	clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
	response: z.object({
		clientDataJSON: base64url,
		authenticatorData: base64url,
		signature: base64url,
		userHandle: base64url.optional()
	})
});

/** A form field holding JSON, read without ever throwing. */
export function readResponseField(value: FormDataEntryValue | null): unknown {
	if (typeof value !== 'string' || value.length > 65_536) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** The WebAuthn user handle for an account: its id, which is a UUID and says nothing about anyone. */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(Buffer.from(userId, 'utf8'));
}

function readTransports(value: string | null): string[] | undefined {
	if (!value) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

/* -------------------------------------------------------------------------- */
/* Adding a passkey                                                            */
/* -------------------------------------------------------------------------- */

export type BeginRegistration =
	| { ok: true; options: PublicKeyCredentialCreationOptionsJSON; ceremony: string }
	| { ok: false; reason: 'unavailable' | 'reauthenticate' };

/**
 * Hand the browser the options to create a passkey with, once the account has
 * shown it is really its owner asking. The ceremony is bound to this user and
 * to this session, so finishing it from anywhere else adds nothing.
 */
export async function beginRegistration(
	user: { id: string; email: string; displayName: string },
	sessionToken: string | null,
	password: string | null,
	now: number = Date.now()
): Promise<BeginRegistration> {
	const rp = relyingParty();
	if (!rp) return { ok: false, reason: 'unavailable' };
	if (!sessionToken) return { ok: false, reason: 'reauthenticate' };
	if (!(await confirmIdentity(user.id, sessionToken, password, now))) {
		return { ok: false, reason: 'reauthenticate' };
	}

	const existing = await db
		.select({ id: passkeys.id, transports: passkeys.transports })
		.from(passkeys)
		.where(eq(passkeys.userId, user.id));

	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: rp.id,
		userName: user.email,
		userDisplayName: user.displayName,
		userID: userHandle(user.id),
		timeout: CHALLENGE_LIFETIME_MS,
		attestationType: 'none',
		// One authenticator, one passkey: registering the same one twice would
		// only make two rows that can never be told apart.
		excludeCredentials: existing.map((row) => ({
			id: row.id,
			transports: readTransports(row.transports)
		})),
		authenticatorSelection: {
			// Discoverable, so the login page can offer it without an email first.
			residentKey: 'required',
			userVerification: 'required'
		}
	});

	const ceremony = await openCeremony(
		'register',
		options.challenge,
		{ userId: user.id, sessionId: hashToken(sessionToken) },
		now
	);
	return { ok: true, options, ceremony };
}

export interface PasskeySummary {
	id: string;
	name: string;
	createdOn: string;
	createdAt: Date;
	lastUsedAt: Date | null;
}

/**
 * Check the authenticator's answer and store the passkey. Anything at all
 * wrong — a spent or foreign ceremony, a response for another origin, a
 * credential somebody already registered — stores nothing.
 */
export async function finishRegistration(
	userId: string,
	sessionToken: string | null,
	ceremonyToken: string | null,
	response: unknown,
	userAgent: string | null,
	now: number = Date.now()
): Promise<{ ok: true; passkey: PasskeySummary } | { ok: false }> {
	const ceremony = await consumeCeremony(ceremonyToken, 'register', now);
	const rp = relyingParty();
	if (!ceremony || !rp || !sessionToken) return { ok: false };
	if (ceremony.userId !== userId || ceremony.sessionId !== hashToken(sessionToken)) {
		return { ok: false };
	}

	const parsed = registrationResponseSchema.safeParse(response);
	if (!parsed.success) return { ok: false };

	let credential;
	try {
		const verification = await verifyRegistrationResponse({
			response: parsed.data as RegistrationResponseJSON,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			requireUserVerification: true
		});
		if (!verification.verified) return { ok: false };
		credential = verification.registrationInfo.credential;
	} catch {
		return { ok: false };
	}

	const device = describeDevice(userAgent);
	const passkey: PasskeySummary = {
		id: credential.id,
		name: device,
		createdOn: device,
		createdAt: new Date(now),
		lastUsedAt: null
	};

	// `do nothing` rather than an upsert: a credential id that is already
	// registered — to this account or any other — is never taken over.
	const inserted = await db
		.insert(passkeys)
		.values({
			id: credential.id,
			userId,
			publicKey: Buffer.from(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports ? JSON.stringify(credential.transports) : null,
			name: passkey.name,
			createdOn: passkey.createdOn,
			createdAt: passkey.createdAt,
			lastUsedAt: null
		})
		.onConflictDoNothing();
	if (inserted.changes === 0) return { ok: false };

	return { ok: true, passkey };
}

/* -------------------------------------------------------------------------- */
/* Signing in                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Options for a sign-in. No credentials are listed — passkeys are
 * discoverable, so the authenticator offers whichever it holds for this
 * domain, and nothing here says which accounts exist.
 */
export async function beginAuthentication(
	now: number = Date.now()
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; ceremony: string } | null> {
	const rp = relyingParty();
	if (!rp) return null;

	const options = await generateAuthenticationOptions({
		rpID: rp.id,
		timeout: CHALLENGE_LIFETIME_MS,
		userVerification: 'required'
	});
	const ceremony = await openCeremony('authenticate', options.challenge, null, now);
	return { options, ceremony };
}

/**
 * Check a sign-in. Success names the account, and the caller creates its
 * session with `createSession()` exactly as a password sign-in does. Every
 * failure is the same `{ ok: false }`, so nothing downstream can tell an
 * unknown credential from a bad signature.
 */
export async function finishAuthentication(
	ceremonyToken: string | null,
	response: unknown,
	now: number = Date.now()
): Promise<{ ok: true; user: { id: string; email: string } } | { ok: false }> {
	// Spent first, whatever follows: a response that fails still uses it up.
	const ceremony = await consumeCeremony(ceremonyToken, 'authenticate', now);
	const rp = relyingParty();
	if (!ceremony || !rp) return { ok: false };

	const parsed = authenticationResponseSchema.safeParse(response);
	if (!parsed.success) return { ok: false };

	const [row] = await db
		.select({ passkey: passkeys, email: users.email })
		.from(passkeys)
		.innerJoin(users, eq(passkeys.userId, users.id))
		.where(eq(passkeys.id, parsed.data.id))
		.limit(1);
	if (!row) return { ok: false };

	const { passkey } = row;

	// The authenticator says whose passkey this is. It has to agree with the row.
	const handle = parsed.data.response.userHandle;
	if (handle !== undefined && handle !== Buffer.from(passkey.userId).toString('base64url')) {
		return { ok: false };
	}

	let newCounter: number;
	try {
		const verification = await verifyAuthenticationResponse({
			response: parsed.data as AuthenticationResponseJSON,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			credential: {
				id: passkey.id,
				publicKey: new Uint8Array(passkey.publicKey),
				counter: passkey.counter,
				transports: readTransports(passkey.transports)
			},
			// The library refuses a counter that has not moved past the stored one.
			requireUserVerification: true
		});
		if (!verification.verified) return { ok: false };
		newCounter = verification.authenticationInfo.newCounter;
	} catch {
		return { ok: false };
	}

	// Conditional on the counter still being what was verified against, so two
	// sign-ins racing with one cloned authenticator cannot both land.
	const updated = await db
		.update(passkeys)
		.set({ counter: newCounter, lastUsedAt: new Date(now) })
		.where(and(eq(passkeys.id, passkey.id), eq(passkeys.counter, passkey.counter)));
	if (updated.changes === 0) return { ok: false };

	return { ok: true, user: { id: passkey.userId, email: row.email } };
}

/* -------------------------------------------------------------------------- */
/* The list under Settings → Security                                          */
/* -------------------------------------------------------------------------- */

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
	return db
		.select({
			id: passkeys.id,
			name: passkeys.name,
			createdOn: passkeys.createdOn,
			createdAt: passkeys.createdAt,
			lastUsedAt: passkeys.lastUsedAt
		})
		.from(passkeys)
		.where(eq(passkeys.userId, userId))
		.orderBy(asc(passkeys.createdAt));
}

/**
 * Rename one. A label changes nothing about what can sign in, so this needs no
 * recent sign-in; ownership is still checked in the statement.
 */
export async function renamePasskey(userId: string, id: string, name: string): Promise<boolean> {
	const trimmed = name.trim().slice(0, PASSKEY_NAME_MAX);
	if (!trimmed) return false;
	const result = await db
		.update(passkeys)
		.set({ name: trimmed })
		.where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
	return result.changes > 0;
}

/**
 * Remove one, behind the same recent-sign-in guard as adding one: otherwise a
 * stolen session could strip the owner's passkeys and leave only the password
 * it is about to try changing.
 */
export async function removePasskey(
	userId: string,
	sessionToken: string | null,
	password: string | null,
	id: string,
	now: number = Date.now()
): Promise<{ ok: true } | { ok: false; reason: 'reauthenticate' | 'not-found' }> {
	if (!(await confirmIdentity(userId, sessionToken, password, now))) {
		return { ok: false, reason: 'reauthenticate' };
	}
	const result = await db
		.delete(passkeys)
		.where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
	return result.changes > 0 ? { ok: true } : { ok: false, reason: 'not-found' };
}
