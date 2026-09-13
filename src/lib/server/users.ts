import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { newId, revokeOtherSessions, type SessionUser } from '$lib/server/auth/session';
import type { RegisterInput } from '$domain/validation';
import { eq } from 'drizzle-orm';

export async function registerUser(
	input: RegisterInput
): Promise<{ ok: true; user: SessionUser } | { ok: false; reason: 'email-taken' }> {
	const [existing] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, input.email))
		.limit(1);
	if (existing) return { ok: false, reason: 'email-taken' };

	const user = {
		id: newId(),
		email: input.email,
		passwordHash: await hashPassword(input.password),
		displayName: input.displayName,
		timeZone: input.timeZone,
		weekStartsOn: input.weekStartsOn,
		createdAt: new Date()
	};
	await db.insert(users).values(user);

	return {
		ok: true,
		user: {
			id: user.id,
			email: user.email,
			displayName: user.displayName,
			timeZone: user.timeZone,
			weekStartsOn: user.weekStartsOn
		}
	};
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
	const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (!row) {
		// Spend comparable time on a missing account so the response does not
		// reveal which emails are registered.
		await hashPassword(password);
		return null;
	}

	if (!(await verifyPassword(row.passwordHash, password))) return null;

	return {
		id: row.id,
		email: row.email,
		displayName: row.displayName,
		timeZone: row.timeZone,
		weekStartsOn: row.weekStartsOn
	};
}

export async function updateProfile(
	userId: string,
	patch: { displayName?: string; timeZone?: string; weekStartsOn?: number }
): Promise<void> {
	await db.update(users).set(patch).where(eq(users.id, userId));
}

/**
 * Change a password, then evict every other session.
 *
 * The current password is verified here rather than in the route, so no caller
 * can change a password without it. Revoking the other sessions is part of the
 * same operation for the same reason: a password is changed when someone else
 * may know the old one, and leaving their thirty-day cookie working would make
 * the change worth very little.
 */
export async function changePassword(
	userId: string,
	currentPassword: string,
	newPassword: string,
	keepToken: string | null
): Promise<{ ok: true; revoked: number } | { ok: false; reason: 'wrong-password' }> {
	const [row] = await db
		.select({ passwordHash: users.passwordHash })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);

	if (!row || !(await verifyPassword(row.passwordHash, currentPassword))) {
		return { ok: false, reason: 'wrong-password' };
	}

	await db
		.update(users)
		.set({ passwordHash: await hashPassword(newPassword) })
		.where(eq(users.id, userId));

	const revoked = await revokeOtherSessions(userId, keepToken);
	return { ok: true, revoked };
}
