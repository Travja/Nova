import { describe, expect, it } from 'vitest';
import {
	backoffDelayMs,
	formatRetryAfter,
	InProcessLimiter,
	type ThrottlePolicy
} from './rate-limit';

const policy: ThrottlePolicy = {
	freeAttempts: 3,
	baseDelayMs: 1_000,
	maxDelayMs: 60_000,
	decayMs: 10 * 60_000
};

describe('backoffDelayMs', () => {
	it('forgives the free attempts', () => {
		expect(backoffDelayMs(0, policy)).toBe(0);
		expect(backoffDelayMs(3, policy)).toBe(0);
	});

	it('doubles the wait for each failure past them', () => {
		expect(backoffDelayMs(4, policy)).toBe(1_000);
		expect(backoffDelayMs(5, policy)).toBe(2_000);
		expect(backoffDelayMs(6, policy)).toBe(4_000);
		expect(backoffDelayMs(7, policy)).toBe(8_000);
	});

	it('never climbs past the ceiling', () => {
		expect(backoffDelayMs(10, policy)).toBe(60_000);
		// A long run must not overflow into Infinity or NaN.
		expect(backoffDelayMs(5_000, policy)).toBe(60_000);
	});
});

describe('InProcessLimiter', () => {
	it('allows an untouched key', async () => {
		const limiter = new InProcessLimiter(policy);
		expect(await limiter.check('someone', 0)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it('blocks once the free attempts are spent, and says for how long', async () => {
		const limiter = new InProcessLimiter(policy);

		for (let i = 0; i < 3; i += 1) {
			expect(await limiter.recordFailure('someone', 0)).toEqual({
				allowed: true,
				retryAfterMs: 0
			});
		}

		expect(await limiter.recordFailure('someone', 0)).toEqual({
			allowed: false,
			retryAfterMs: 1_000
		});
		expect(await limiter.check('someone', 500)).toEqual({ allowed: false, retryAfterMs: 500 });
	});

	it('lets the attempt through once the wait has passed', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 4; i += 1) await limiter.recordFailure('someone', 0);

		expect((await limiter.check('someone', 999)).allowed).toBe(false);
		expect(await limiter.check('someone', 1_000)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it('counts a failure after the wait as the next step up, not a fresh start', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 4; i += 1) await limiter.recordFailure('someone', 0);

		expect(await limiter.recordFailure('someone', 1_000)).toEqual({
			allowed: false,
			retryAfterMs: 2_000
		});
	});

	it('keeps keys apart', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 4; i += 1) await limiter.recordFailure('someone', 0);

		expect((await limiter.check('someone-else', 0)).allowed).toBe(true);
	});

	it('forgets a key that has sat idle for the decay window', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 6; i += 1) await limiter.recordFailure('someone', 0);
		expect((await limiter.check('someone', 3_000)).allowed).toBe(false);

		const later = policy.decayMs;
		expect(await limiter.check('someone', later)).toEqual({ allowed: true, retryAfterMs: 0 });
		// And the next failure starts the count over.
		expect(await limiter.recordFailure('someone', later)).toEqual({
			allowed: true,
			retryAfterMs: 0
		});
	});

	it('clears a key on demand', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 5; i += 1) await limiter.recordFailure('someone', 0);
		expect((await limiter.check('someone', 0)).allowed).toBe(false);

		await limiter.clear('someone');
		expect(await limiter.check('someone', 0)).toEqual({ allowed: true, retryAfterMs: 0 });
	});

	it('drops decayed keys instead of growing for ever', async () => {
		const limiter = new InProcessLimiter(policy);
		for (let i = 0; i < 50; i += 1) await limiter.recordFailure(`address-${i}`, 0);
		expect(limiter.size).toBe(50);

		// One failure past the decay window sweeps the abandoned keys.
		await limiter.recordFailure('address-fresh', policy.decayMs + 1);
		expect(limiter.size).toBe(1);
	});
});

describe('formatRetryAfter', () => {
	it('rounds up to whole seconds and never says zero', () => {
		expect(formatRetryAfter(1)).toBe('1 second');
		expect(formatRetryAfter(1_500)).toBe('2 seconds');
		expect(formatRetryAfter(59_000)).toBe('59 seconds');
	});

	it('switches to minutes', () => {
		expect(formatRetryAfter(60_000)).toBe('1 minute');
		expect(formatRetryAfter(61_000)).toBe('2 minutes');
		expect(formatRetryAfter(15 * 60_000)).toBe('15 minutes');
	});
});
