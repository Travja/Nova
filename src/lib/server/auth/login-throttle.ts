import {
	InProcessLimiter,
	type AttemptLimiter,
	type AttemptVerdict,
	type ThrottlePolicy
} from '$lib/server/rate-limit';
import { createHash } from 'node:crypto';

/**
 * Sign-in throttling, per account and per address.
 *
 * Both counters are consulted for every attempt and the longer wait wins. The
 * account counter stops one address working through a password list against a
 * single mailbox; the address counter stops one client working through a list
 * of mailboxes. Neither knows whether the email exists — a bucket is keyed on
 * what was typed, so an unknown address is throttled exactly like a real one
 * and the response cannot be used to tell them apart.
 */

/**
 * Four wrong passwords is a bad day; the fifth starts a wait that doubles —
 * five seconds, then ten, and past a thousand attempts a day is impossible.
 * The ceiling matters: a per-account limit is also a way to lock someone out,
 * so the worst an attacker can impose is a quarter of an hour at a time.
 */
export const ACCOUNT_POLICY: ThrottlePolicy = {
	freeAttempts: 4,
	baseDelayMs: 5_000,
	maxDelayMs: 15 * 60_000,
	decayMs: 60 * 60_000
};

/** Looser, because a household or an office shares one address. */
export const ADDRESS_POLICY: ThrottlePolicy = {
	freeAttempts: 12,
	baseDelayMs: 2_000,
	maxDelayMs: 15 * 60_000,
	decayMs: 60 * 60_000
};

export interface LoginAttempt {
	/** As typed, registered or not. */
	email: string;
	/** The client address, or null when the platform cannot say. */
	address: string | null;
}

/**
 * Emails are hashed before they become keys so the limiter never holds a list
 * of addresses people have tried to sign in with.
 */
function accountKey(email: string): string {
	return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function worse(a: AttemptVerdict, b: AttemptVerdict): AttemptVerdict {
	return b.retryAfterMs > a.retryAfterMs ? b : a;
}

export class LoginThrottle {
	readonly #accounts: AttemptLimiter;
	readonly #addresses: AttemptLimiter;

	constructor(
		accounts: AttemptLimiter = new InProcessLimiter(ACCOUNT_POLICY),
		addresses: AttemptLimiter = new InProcessLimiter(ADDRESS_POLICY)
	) {
		this.#accounts = accounts;
		this.#addresses = addresses;
	}

	/** Whether this attempt may be tried at all, and how long until it can be. */
	async check(attempt: LoginAttempt, now?: number): Promise<AttemptVerdict> {
		const account = await this.#accounts.check(accountKey(attempt.email), now);
		if (!attempt.address) return account;
		return worse(account, await this.#addresses.check(attempt.address, now));
	}

	/** Count a wrong password — or an email nobody has registered. */
	async recordFailure(attempt: LoginAttempt, now?: number): Promise<AttemptVerdict> {
		const account = await this.#accounts.recordFailure(accountKey(attempt.email), now);
		if (!attempt.address) return account;
		return worse(account, await this.#addresses.recordFailure(attempt.address, now));
	}

	/**
	 * Forgive the account on a successful sign-in. The address counter is left
	 * alone deliberately: clearing it would let anyone holding one working
	 * account reset the limit that guards every other account from that client.
	 */
	async recordSuccess(attempt: LoginAttempt): Promise<void> {
		await this.#accounts.clear(accountKey(attempt.email));
	}
}

/** The process-wide throttle the sign-in action uses. */
export const loginThrottle = new LoginThrottle();
