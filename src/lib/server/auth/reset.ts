import { db } from '$lib/server/db';
import { passwordResetTokens, users, type PasswordResetTokenRow } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth/password';
import { hashToken, newToken } from '$lib/server/auth/token';
import { revokeOtherSessions } from '$lib/server/auth/session';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Password resets, following the session pattern: a random token in the
 * mailbox, its SHA-256 in the database, short-lived and single use.
 */

/** Long enough for a mail server to be slow, short enough to be worth little if it leaks. */
export const RESET_LIFETIME_MS = 30 * 60 * 1000;

export const RESET_LIFETIME_MINUTES = RESET_LIFETIME_MS / 60_000;

export interface PasswordReset {
	/** The raw token. It goes in the email and is never stored or logged. */
	token: string;
	expiresAt: Date;
	user: { id: string; email: string; displayName: string };
}

/** Whether a row can still be spent. Pure, so the rules are testable on their own. */
export function isUsable(
	row: Pick<PasswordResetTokenRow, 'expiresAt' | 'usedAt'>,
	now: Date = new Date()
): boolean {
	if (row.usedAt) return false;
	return row.expiresAt.getTime() > now.getTime();
}

/**
 * Mint a reset for whoever owns this address, or null if nobody does.
 *
 * The caller must answer the same way either way — the null is for deciding
 * whether to send an email, never for deciding what to tell the visitor.
 */
export async function createPasswordReset(email: string): Promise<PasswordReset | null> {
	const [user] = await db
		.select({ id: users.id, email: users.email, displayName: users.displayName })
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
		.limit(1);
	if (!user) return null;

	// One live link per account: asking again replaces the last one, so a reset
	// mail sitting in an old inbox stops working the moment a newer one is sent.
	await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

	const token = newToken();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + RESET_LIFETIME_MS);
	await db.insert(passwordResetTokens).values({
		id: hashToken(token),
		userId: user.id,
		expiresAt,
		createdAt: now,
		usedAt: null
	});

	return { token, expiresAt, user };
}

/** Whether this token would still work, for deciding what form to render. */
export async function resetTokenIsUsable(token: string): Promise<boolean> {
	const [row] = await db
		.select({ expiresAt: passwordResetTokens.expiresAt, usedAt: passwordResetTokens.usedAt })
		.from(passwordResetTokens)
		.where(eq(passwordResetTokens.id, hashToken(token)))
		.limit(1);
	return row ? isUsable(row) : false;
}

/**
 * Spend a token and set the new password.
 *
 * Everything that makes this safe happens here rather than in the route: the
 * token is re-read and re-checked under its hash, it is stamped used in the
 * same breath, and every session is revoked — whoever prompted the reset does
 * not get to keep a thirty-day cookie.
 */
export async function completePasswordReset(
	token: string,
	newPassword: string
): Promise<{ ok: true } | { ok: false; reason: 'invalid' }> {
	const id = hashToken(token);
	const [row] = await db
		.select()
		.from(passwordResetTokens)
		.where(eq(passwordResetTokens.id, id))
		.limit(1);

	if (!row || !isUsable(row)) return { ok: false, reason: 'invalid' };

	const digest = await hashPassword(newPassword);

	// Stamping `used_at` under "still unused" means two arrivals of the same
	// link cannot both set a password; the loser changes nothing.
	const claim = await db
		.update(passwordResetTokens)
		.set({ usedAt: new Date() })
		.where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt)));
	if (claim.changes === 0) return { ok: false, reason: 'invalid' };

	await db.update(users).set({ passwordHash: digest }).where(eq(users.id, row.userId));
	await revokeOtherSessions(row.userId, null);

	return { ok: true };
}
