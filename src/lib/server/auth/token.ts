import { createHash, randomBytes } from 'node:crypto';

/**
 * The pattern both sessions and password resets follow: the holder gets a
 * random token, the database stores only its SHA-256. A leaked database
 * therefore cannot be used to impersonate anyone or to reset anything.
 *
 * SHA-256 with no salt is right here and wrong for passwords — the input is
 * 256 bits of entropy, so there is nothing to guess and nothing to precompute.
 */

/** 32 random bytes, URL-safe, so it survives an email client's line wrapping. */
export function newToken(): string {
	return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}
