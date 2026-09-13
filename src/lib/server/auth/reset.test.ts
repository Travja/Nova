import { describe, expect, it } from 'vitest';
import { isUsable, RESET_LIFETIME_MINUTES, RESET_LIFETIME_MS } from './reset';
import { hashToken, newToken } from './token';

const now = new Date('2026-09-13T12:00:00Z');

describe('isUsable', () => {
	it('accepts an unspent token inside its window', () => {
		expect(isUsable({ expiresAt: new Date('2026-09-13T12:01:00Z'), usedAt: null }, now)).toBe(true);
	});

	it('rejects a token that has been spent, however fresh', () => {
		expect(isUsable({ expiresAt: new Date('2026-09-13T12:29:00Z'), usedAt: new Date() }, now)).toBe(
			false
		);
	});

	it('rejects an expired token', () => {
		expect(isUsable({ expiresAt: new Date('2026-09-13T11:59:59Z'), usedAt: null }, now)).toBe(
			false
		);
	});

	it('treats the expiry instant as gone', () => {
		expect(isUsable({ expiresAt: now, usedAt: null }, now)).toBe(false);
	});

	it('stays short-lived', () => {
		expect(RESET_LIFETIME_MINUTES).toBe(30);
		expect(RESET_LIFETIME_MS).toBeLessThanOrEqual(60 * 60_000);
	});
});

describe('reset tokens', () => {
	it('are long, URL-safe and never repeat', () => {
		const tokens = new Set(Array.from({ length: 100 }, newToken));
		expect(tokens.size).toBe(100);
		for (const token of tokens) {
			expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		}
	});

	it('hash to something that cannot be read back', () => {
		const token = newToken();
		const digest = hashToken(token);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(digest).not.toContain(token);
		// Same token, same row; different token, different row.
		expect(hashToken(token)).toBe(digest);
		expect(hashToken(newToken())).not.toBe(digest);
	});
});
