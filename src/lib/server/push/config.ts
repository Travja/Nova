import { readOrigin } from '$lib/server/mail/config';

/**
 * Whether this instance can send push at all, decided entirely by the
 * environment — the same shape mail takes, and for the same reason.
 *
 * VAPID keys are deployment configuration, not a feature flag: an instance that
 * never sets them sends no reminders, offers nobody the opt-in, and reaches no
 * push service. Nothing is the default.
 *
 * Generate a pair with the library this depends on:
 *
 * ```
 * npx web-push generate-vapid-keys
 * ```
 *
 * The public key is handed to browsers and is not a secret. The private key is,
 * and it is the one thing that lets anyone push to the devices subscribed with
 * its pair — rotating it invalidates every subscription, which is the correct
 * response to leaking it.
 */

export interface VapidSettings {
	/** Handed to `pushManager.subscribe()`; public by design. */
	publicKey: string;
	privateKey: string;
	/**
	 * How a push service reaches the operator about a misbehaving sender. A
	 * `mailto:` or an `https:` URL; the spec requires one and the services
	 * enforce it.
	 */
	subject: string;
}

export type PushConfig = { kind: 'vapid'; vapid: VapidSettings } | { kind: 'none' };

function trimmed(value: string | undefined): string | null {
	const result = value?.trim();
	return result ? result : null;
}

/** A P-256 point is 65 bytes and its private scalar 32, base64url with no padding. */
const PUBLIC_KEY_LENGTH = 87;
const PRIVATE_KEY_LENGTH = 43;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function usableKey(value: string | null, length: number): boolean {
	return value !== null && value.length === length && BASE64URL.test(value);
}

/**
 * Both keys, or nothing.
 *
 * A half-configured instance is the dangerous case: the opt-in would appear,
 * a device would subscribe against a public key whose pair cannot sign, and
 * every send would fail silently forever. A malformed key is treated the same
 * way as a missing one for exactly that reason — the failure belongs at boot,
 * where the operator can see it, rather than months later on somebody's phone.
 */
export function readPushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
	const publicKey = trimmed(env.VAPID_PUBLIC_KEY);
	const privateKey = trimmed(env.VAPID_PRIVATE_KEY);
	if (!publicKey && !privateKey) return { kind: 'none' };
	if (!usableKey(publicKey, PUBLIC_KEY_LENGTH) || !usableKey(privateKey, PRIVATE_KEY_LENGTH)) {
		return { kind: 'none' };
	}

	// The origin is already the one absolute URL this instance is sure of, and
	// a push service only ever uses the subject to find a human.
	const subject = trimmed(env.VAPID_SUBJECT) ?? readOrigin(env);
	if (!subject) return { kind: 'none' };

	return { kind: 'vapid', vapid: { publicKey: publicKey!, privateKey: privateKey!, subject } };
}

/** Whether a half-configured instance is what we are looking at, for the log line. */
export function partiallyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
	const publicKey = trimmed(env.VAPID_PUBLIC_KEY);
	const privateKey = trimmed(env.VAPID_PRIVATE_KEY);
	return (publicKey !== null || privateKey !== null) && readPushConfig(env).kind === 'none';
}
