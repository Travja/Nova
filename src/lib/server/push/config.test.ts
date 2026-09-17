import { describe, expect, it } from 'vitest';
import { partiallyConfigured, readPushConfig } from './config';

/**
 * Keys with the right shape and no meaning.
 *
 * `readPushConfig()` does no cryptography — it checks that a P-256 point and
 * its scalar are the lengths and the alphabet they have to be, and leaves the
 * maths to `web-push` — so the shape is the whole of what these tests need.
 * Real keys, even throwaway ones, do not belong in a repository.
 */
const PUBLIC_KEY = `B${'e'.repeat(86)}`;
const PRIVATE_KEY = 'e'.repeat(43);

const configured = {
	VAPID_PUBLIC_KEY: PUBLIC_KEY,
	VAPID_PRIVATE_KEY: PRIVATE_KEY,
	VAPID_SUBJECT: 'mailto:ops@example.com'
};

describe('readPushConfig', () => {
	it('is off when nothing is set, which is the default', () => {
		expect(readPushConfig({}).kind).toBe('none');
	});

	it('reads a configured pair', () => {
		const config = readPushConfig(configured);
		expect(config).toEqual({
			kind: 'vapid',
			vapid: {
				publicKey: PUBLIC_KEY,
				privateKey: PRIVATE_KEY,
				subject: 'mailto:ops@example.com'
			}
		});
	});

	it('falls back to the origin for a subject, which is the one URL an instance knows', () => {
		const config = readPushConfig({
			VAPID_PUBLIC_KEY: PUBLIC_KEY,
			VAPID_PRIVATE_KEY: PRIVATE_KEY,
			ORIGIN: 'https://nova.example.com/'
		});
		expect(config.kind === 'vapid' && config.vapid.subject).toBe('https://nova.example.com');
	});

	it('stays off when only one half of the pair is set', () => {
		expect(readPushConfig({ VAPID_PUBLIC_KEY: PUBLIC_KEY }).kind).toBe('none');
		expect(readPushConfig({ VAPID_PRIVATE_KEY: PRIVATE_KEY }).kind).toBe('none');
	});

	it('stays off for a key that is the wrong shape', () => {
		// A truncated paste is the realistic mistake, and it would otherwise fail
		// silently on somebody's phone months later.
		expect(readPushConfig({ ...configured, VAPID_PUBLIC_KEY: PUBLIC_KEY.slice(0, 40) }).kind).toBe(
			'none'
		);
		expect(readPushConfig({ ...configured, VAPID_PRIVATE_KEY: 'not a key' }).kind).toBe('none');
		expect(
			readPushConfig({ ...configured, VAPID_PUBLIC_KEY: `${PUBLIC_KEY.slice(0, 86)}+` }).kind
		).toBe('none');
	});

	it('stays off with keys but nothing to identify the sender', () => {
		expect(
			readPushConfig({
				VAPID_PUBLIC_KEY: PUBLIC_KEY,
				VAPID_PRIVATE_KEY: PRIVATE_KEY,
				NODE_ENV: 'production'
			}).kind
		).toBe('none');
	});

	it('knows the difference between unset and half set, for the log line', () => {
		expect(partiallyConfigured({})).toBe(false);
		expect(partiallyConfigured(configured)).toBe(false);
		expect(partiallyConfigured({ VAPID_PUBLIC_KEY: PUBLIC_KEY })).toBe(true);
	});
});
