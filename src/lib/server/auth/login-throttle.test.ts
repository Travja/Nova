import { describe, expect, it } from 'vitest';
import { InProcessLimiter, type ThrottlePolicy } from '$lib/server/rate-limit';
import { ACCOUNT_POLICY, ADDRESS_POLICY, LoginThrottle } from './login-throttle';

const accountPolicy: ThrottlePolicy = {
	freeAttempts: 2,
	baseDelayMs: 1_000,
	maxDelayMs: 60_000,
	decayMs: 10 * 60_000
};

const addressPolicy: ThrottlePolicy = {
	freeAttempts: 4,
	baseDelayMs: 4_000,
	maxDelayMs: 60_000,
	decayMs: 10 * 60_000
};

function throttle() {
	return new LoginThrottle(
		new InProcessLimiter(accountPolicy),
		new InProcessLimiter(addressPolicy)
	);
}

describe('LoginThrottle', () => {
	it('lets a first attempt through', async () => {
		const t = throttle();
		expect(await t.check({ email: 'pilot@example.com', address: '10.0.0.1' }, 0)).toEqual({
			allowed: true,
			retryAfterMs: 0
		});
	});

	it('throttles one account however the email is capitalised or padded', async () => {
		const t = throttle();
		const attempt = { email: 'Pilot@Example.com ', address: '10.0.0.1' };
		for (let i = 0; i < 3; i += 1) await t.recordFailure(attempt, 0);

		const verdict = await t.check({ email: 'pilot@example.com', address: '10.0.0.2' }, 0);
		expect(verdict).toEqual({ allowed: false, retryAfterMs: 1_000 });
	});

	it('throttles an address that is working through different mailboxes', async () => {
		const t = throttle();
		for (let i = 0; i < 5; i += 1) {
			await t.recordFailure({ email: `nobody-${i}@example.com`, address: '10.0.0.1' }, 0);
		}

		// No account has seen more than one failure, but the client has seen five.
		expect(await t.check({ email: 'fresh@example.com', address: '10.0.0.1' }, 0)).toEqual({
			allowed: false,
			retryAfterMs: 4_000
		});
		expect((await t.check({ email: 'fresh@example.com', address: '10.0.0.2' }, 0)).allowed).toBe(
			true
		);
	});

	it('reports the longer of the two waits', async () => {
		const t = throttle();
		// Three failures on one account (1s) from one address that also has five
		// failures overall (4s): the address wait is the one that matters.
		for (let i = 0; i < 3; i += 1) {
			await t.recordFailure({ email: 'pilot@example.com', address: '10.0.0.1' }, 0);
		}
		for (let i = 0; i < 2; i += 1) {
			await t.recordFailure({ email: `nobody-${i}@example.com`, address: '10.0.0.1' }, 0);
		}

		expect(await t.check({ email: 'pilot@example.com', address: '10.0.0.1' }, 0)).toEqual({
			allowed: false,
			retryAfterMs: 4_000
		});
	});

	it('treats an unregistered email exactly like a registered one', async () => {
		// The limiter is keyed on what was typed and never asks whether the
		// account exists, so a throttled response cannot be used to enumerate
		// mailboxes. Two identical runs of failures must produce identical waits.
		const known = throttle();
		const unknown = throttle();

		for (let i = 0; i < 4; i += 1) {
			await known.recordFailure({ email: 'pilot@example.com', address: '10.0.0.1' }, 0);
			await unknown.recordFailure({ email: 'ghost@example.com', address: '10.0.0.1' }, 0);
		}

		expect(await known.check({ email: 'pilot@example.com', address: '10.0.0.1' }, 0)).toEqual(
			await unknown.check({ email: 'ghost@example.com', address: '10.0.0.1' }, 0)
		);
	});

	it('still throttles per account when the platform has no address', async () => {
		const t = throttle();
		const attempt = { email: 'pilot@example.com', address: null };
		for (let i = 0; i < 3; i += 1) await t.recordFailure(attempt, 0);

		expect(await t.check(attempt, 0)).toEqual({ allowed: false, retryAfterMs: 1_000 });
	});

	it('forgives the account on success but keeps the address counter', async () => {
		const t = throttle();
		const attempt = { email: 'pilot@example.com', address: '10.0.0.1' };
		for (let i = 0; i < 5; i += 1) await t.recordFailure(attempt, 0);

		await t.recordSuccess(attempt);

		// The account is clean; the address it came from is not, so one working
		// password cannot be used to reset the limit guarding every other account.
		expect((await t.check({ email: 'pilot@example.com', address: null }, 0)).allowed).toBe(true);
		expect((await t.check(attempt, 0)).allowed).toBe(false);
	});

	it('ships policies that cap the lockout an attacker can impose', () => {
		// A per-account limit is also a denial-of-service tool; the ceiling is
		// what keeps a locked-out user from being locked out indefinitely.
		expect(ACCOUNT_POLICY.maxDelayMs).toBeLessThanOrEqual(15 * 60_000);
		expect(ACCOUNT_POLICY.freeAttempts).toBeGreaterThanOrEqual(3);
		expect(ADDRESS_POLICY.freeAttempts).toBeGreaterThan(ACCOUNT_POLICY.freeAttempts);
	});
});
