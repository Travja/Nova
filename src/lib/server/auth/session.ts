import { db } from '$lib/server/db';
import { sessions, users, type UserRow } from '$lib/server/db/schema';
import { describeDevice } from '$lib/server/auth/user-agent';
import type { Cookies } from '@sveltejs/kit';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'nova_session';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions past their halfway point are extended on use, so active users stay signed in. */
const RENEW_THRESHOLD_MS = SESSION_LIFETIME_MS / 2;
/** "Last used" is only refreshed this often, so a busy tab is not a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** How long a user agent may be before it is stored truncated. */
const USER_AGENT_MAX = 400;

/**
 * The browser holds a random token; the database holds only its SHA-256. A
 * leaked database therefore cannot be used to impersonate anyone.
 */
function tokenToId(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export interface SessionUser {
	id: string;
	email: string;
	displayName: string;
	timeZone: string;
	weekStartsOn: number;
}

function toSessionUser(row: UserRow): SessionUser {
	return {
		id: row.id,
		email: row.email,
		displayName: row.displayName,
		timeZone: row.timeZone,
		weekStartsOn: row.weekStartsOn
	};
}

export async function createSession(
	userId: string,
	userAgent?: string | null
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
	await db.insert(sessions).values({
		id: tokenToId(token),
		userId,
		expiresAt,
		createdAt: now,
		userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
		lastSeenAt: now
	});
	return { token, expiresAt };
}

export async function validateSession(token: string): Promise<SessionUser | null> {
	const id = tokenToId(token);
	const [row] = await db
		.select({ user: users, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.limit(1);

	if (!row) return null;

	if (row.expiresAt.getTime() <= Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	// One write covers both the renewal and the "last used" stamp, and neither
	// happens on most requests.
	const now = Date.now();
	const patch: { expiresAt?: Date; lastSeenAt?: Date } = {};
	if (row.expiresAt.getTime() - now < RENEW_THRESHOLD_MS) {
		patch.expiresAt = new Date(now + SESSION_LIFETIME_MS);
	}
	if (!row.lastSeenAt || now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
		patch.lastSeenAt = new Date(now);
	}
	if (patch.expiresAt || patch.lastSeenAt) {
		await db.update(sessions).set(patch).where(eq(sessions.id, id));
	}

	return toSessionUser(row.user);
}

/**
 * One row per session a user could still sign in with.
 *
 * `id` is the SHA-256 the database holds, not the token — it is safe to put in
 * a form, and knowing it does not let anyone use the session.
 */
export interface ActiveSession {
	id: string;
	device: string;
	createdAt: Date;
	lastSeenAt: Date;
	expiresAt: Date;
	/** Whether this is the session making the request. */
	current: boolean;
}

export async function listSessions(
	userId: string,
	currentToken: string | null
): Promise<ActiveSession[]> {
	const currentId = currentToken ? tokenToId(currentToken) : null;

	const rows = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
		.orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));

	return rows.map((row) => ({
		id: row.id,
		device: describeDevice(row.userAgent),
		createdAt: row.createdAt,
		lastSeenAt: row.lastSeenAt ?? row.createdAt,
		expiresAt: row.expiresAt,
		current: row.id === currentId
	}));
}

/**
 * Revoke one session. Ownership is checked here rather than in the route, so
 * no caller can revoke a session belonging to somebody else however the id
 * reached it. Returns whether a row was actually removed.
 */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
	const result = await db
		.delete(sessions)
		.where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
	return result.changes > 0;
}

/**
 * Sign every other device out, keeping the session that asked. Used by the
 * session list and by a password change, where the point is to evict whoever
 * might have been using the old password.
 */
export async function revokeOtherSessions(
	userId: string,
	keepToken: string | null
): Promise<number> {
	const keepId = keepToken ? tokenToId(keepToken) : null;
	const result = await db
		.delete(sessions)
		.where(
			keepId
				? and(eq(sessions.userId, userId), ne(sessions.id, keepId))
				: eq(sessions.userId, userId)
		);
	return result.changes;
}

export async function invalidateSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, tokenToId(token)));
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function newId(): string {
	return randomUUID();
}
