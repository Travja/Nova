/**
 * A deliberately small attempt limiter.
 *
 * The only state it keeps per key is a failure count and when the last failure
 * landed, which is enough for exponential backoff and little enough that the
 * same interface fits a `rate_limits` table or a Redis hash later. Every method
 * is async for that reason — the in-process store answers immediately, a remote
 * one would not, and callers already await.
 */

export interface AttemptVerdict {
	/** Whether the caller may go ahead with the attempt. */
	allowed: boolean;
	/** How long until the next attempt is allowed. Zero when allowed. */
	retryAfterMs: number;
}

export interface ThrottlePolicy {
	/** Failures forgiven before backoff starts at all. */
	freeAttempts: number;
	/** The wait after the first failure past the free ones. */
	baseDelayMs: number;
	/** Ceiling on the wait, however long the run of failures gets. */
	maxDelayMs: number;
	/** A key untouched for this long is forgotten entirely. */
	decayMs: number;
}

/**
 * The whole surface a caller needs. Keys are opaque strings, so a backing store
 * never has to know whether it is holding an email digest or an address.
 */
export interface AttemptLimiter {
	/** What would happen to an attempt on this key right now. Records nothing. */
	check(key: string, now?: number): Promise<AttemptVerdict>;
	/** Count a failed attempt and report the wait it earned. */
	recordFailure(key: string, now?: number): Promise<AttemptVerdict>;
	/** Forget a key — a success, or an administrative unblock. */
	clear(key: string): Promise<void>;
}

const ALLOWED: AttemptVerdict = { allowed: true, retryAfterMs: 0 };

/**
 * The wait earned by `failures` consecutive failures: nothing while they are
 * free, then a doubling delay from `baseDelayMs` up to `maxDelayMs`.
 */
export function backoffDelayMs(failures: number, policy: ThrottlePolicy): number {
	const punished = failures - policy.freeAttempts;
	if (punished <= 0) return 0;

	// 2 ** 1024 is Infinity, and Math.min would happily return it.
	const doublings = Math.min(punished - 1, 32);
	return Math.min(policy.baseDelayMs * 2 ** doublings, policy.maxDelayMs);
}

interface Bucket {
	failures: number;
	lastFailureAt: number;
}

/** How often the store walks itself looking for keys that have decayed. */
const PRUNE_INTERVAL_MS = 60_000;

/**
 * Keeps buckets in a Map. Correct for one process, which is what Nova runs;
 * behind several containers each would throttle on its own share of the
 * traffic, at which point this moves to the database.
 */
export class InProcessLimiter implements AttemptLimiter {
	readonly #policy: ThrottlePolicy;
	readonly #buckets = new Map<string, Bucket>();
	#lastPruneAt = 0;

	constructor(policy: ThrottlePolicy) {
		this.#policy = policy;
	}

	async check(key: string, now = Date.now()): Promise<AttemptVerdict> {
		const bucket = this.#live(key, now);
		if (!bucket) return ALLOWED;

		const delay = backoffDelayMs(bucket.failures, this.#policy);
		const retryAfterMs = bucket.lastFailureAt + delay - now;
		return retryAfterMs > 0 ? { allowed: false, retryAfterMs } : ALLOWED;
	}

	async recordFailure(key: string, now = Date.now()): Promise<AttemptVerdict> {
		this.#prune(now);

		const bucket = this.#live(key, now) ?? { failures: 0, lastFailureAt: now };
		bucket.failures += 1;
		bucket.lastFailureAt = now;
		this.#buckets.set(key, bucket);

		const retryAfterMs = backoffDelayMs(bucket.failures, this.#policy);
		return retryAfterMs > 0 ? { allowed: false, retryAfterMs } : ALLOWED;
	}

	async clear(key: string): Promise<void> {
		this.#buckets.delete(key);
	}

	/** Test seam: how many keys are being tracked. */
	get size(): number {
		return this.#buckets.size;
	}

	/** The bucket for a key, unless it has sat idle long enough to be forgiven. */
	#live(key: string, now: number): Bucket | undefined {
		const bucket = this.#buckets.get(key);
		if (!bucket) return undefined;

		if (now - bucket.lastFailureAt >= this.#policy.decayMs) {
			this.#buckets.delete(key);
			return undefined;
		}
		return bucket;
	}

	/**
	 * Drop decayed keys so a long run of attempts against made-up addresses
	 * cannot grow the map without bound.
	 */
	#prune(now: number): void {
		if (now - this.#lastPruneAt < PRUNE_INTERVAL_MS) return;
		this.#lastPruneAt = now;

		for (const [key, bucket] of this.#buckets) {
			if (now - bucket.lastFailureAt >= this.#policy.decayMs) this.#buckets.delete(key);
		}
	}
}

/** "in 30 seconds" / "in 2 minutes" — rounded up, never "in 0 seconds". */
export function formatRetryAfter(retryAfterMs: number): string {
	const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
	if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;

	const minutes = Math.ceil(seconds / 60);
	return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
