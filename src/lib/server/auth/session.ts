import { db } from '$lib/server/db';
import { sessions, users, type UserRow } from '$lib/server/db/schema';
import type { Cookies } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'nova_session';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Sessions past their halfway point are extended on use, so active users stay signed in. */
const RENEW_THRESHOLD_MS = SESSION_LIFETIME_MS / 2;

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

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
	await db.insert(sessions).values({
		id: tokenToId(token),
		userId,
		expiresAt,
		createdAt: new Date()
	});
	return { token, expiresAt };
}

export async function validateSession(token: string): Promise<SessionUser | null> {
	const id = tokenToId(token);
	const [row] = await db
		.select({ user: users, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id))
		.limit(1);

	if (!row) return null;

	if (row.expiresAt.getTime() <= Date.now()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return null;
	}

	if (row.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) })
			.where(eq(sessions.id, id));
	}

	return toSessionUser(row.user);
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
