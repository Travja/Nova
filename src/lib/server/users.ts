import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword, verifyPassword } from '$lib/server/auth/password';
import { newId, type SessionUser } from '$lib/server/auth/session';
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
