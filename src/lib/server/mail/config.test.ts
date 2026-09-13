import { describe, expect, it } from 'vitest';
import { readMailConfig, readOrigin } from './config';

describe('readMailConfig', () => {
	it('sends nothing when nothing is configured', () => {
		expect(readMailConfig({})).toEqual({ kind: 'none' });
	});

	it('reads an SMTP server, defaulting the port and the sender', () => {
		expect(
			readMailConfig({ SMTP_HOST: 'mail.example.com', SMTP_USER: 'nova@example.com' })
		).toEqual({
			kind: 'smtp',
			smtp: {
				host: 'mail.example.com',
				port: 587,
				secure: false,
				user: 'nova@example.com',
				pass: null,
				from: 'nova@example.com'
			}
		});
	});

	it('treats port 465 as implicit TLS and lets the setting override', () => {
		const implicit = readMailConfig({ SMTP_HOST: 'mail.example.com', SMTP_PORT: '465' });
		expect(implicit).toMatchObject({ smtp: { port: 465, secure: true } });

		const overridden = readMailConfig({
			SMTP_HOST: 'mail.example.com',
			SMTP_PORT: '465',
			SMTP_SECURE: 'false'
		});
		expect(overridden).toMatchObject({ smtp: { port: 465, secure: false } });
	});

	it('falls back to the default port when the value makes no sense', () => {
		expect(readMailConfig({ SMTP_HOST: 'mail.example.com', SMTP_PORT: 'soon' })).toMatchObject({
			smtp: { port: 587 }
		});
		expect(readMailConfig({ SMTP_HOST: 'mail.example.com', SMTP_PORT: '99999' })).toMatchObject({
			smtp: { port: 587 }
		});
	});

	it('prefers an explicit outbox over a configured server', () => {
		// A dev machine with production credentials in its environment must not
		// be one keystroke away from mailing a real person.
		expect(
			readMailConfig({ SMTP_HOST: 'mail.example.com', MAIL_OUTBOX_DIR: './data/outbox' })
		).toEqual({
			kind: 'outbox',
			outbox: { directory: './data/outbox', from: 'Nova <nova@localhost>' }
		});
	});

	it('ignores blank settings', () => {
		expect(readMailConfig({ SMTP_HOST: '   ', MAIL_OUTBOX_DIR: '' })).toEqual({ kind: 'none' });
	});
});

describe('readOrigin', () => {
	it('trims a trailing slash so links do not double up', () => {
		expect(readOrigin({ ORIGIN: 'https://nova.example.com/' })).toBe('https://nova.example.com');
	});

	it('has no fallback in production', () => {
		// A link built from a request header would point wherever the sender
		// liked, so a missing ORIGIN has to stop the send, not guess.
		expect(readOrigin({ NODE_ENV: 'production' })).toBeNull();
	});

	it('assumes the dev server anywhere else', () => {
		expect(readOrigin({})).toBe('http://localhost:5173');
	});
});
