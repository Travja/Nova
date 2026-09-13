import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED, redact, serializeError } from './log';

function capture(level: 'debug' | 'info' = 'debug') {
	const lines: string[] = [];
	const logger = createLogger({
		level,
		write: (line) => lines.push(line),
		now: () => new Date('2026-03-08T12:00:00.000Z')
	});
	return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
}

describe('redact', () => {
	it('drops anything whose key names a secret, however it is spelled', () => {
		const safe = redact({
			password: 'hunter2',
			passwordConfirm: 'hunter2',
			sessionToken: 'abc',
			nova_session: 'abc',
			'Set-Cookie': 'nova_session=abc',
			Authorization: 'Bearer abc',
			apiKey: 'k'
		}) as Record<string, unknown>;

		for (const value of Object.values(safe)) expect(value).toBe(REDACTED);
	});

	it('redacts nested secrets while keeping the shape', () => {
		const safe = redact({ form: { email: 'a@b.test', password: 'hunter2' } }) as {
			form: Record<string, unknown>;
		};
		expect(safe.form.email).toBe('a@b.test');
		expect(safe.form.password).toBe(REDACTED);
	});

	it('survives cycles and deep nesting', () => {
		const cyclic: Record<string, unknown> = { name: 'goal' };
		cyclic.self = cyclic;
		expect(() => JSON.stringify(redact(cyclic))).not.toThrow();
		expect(redact({ a: { b: { c: { d: { e: 'deep' } } } } })).toEqual({
			a: { b: { c: { d: '[truncated]' } } }
		});
	});

	it('redacts cookie headers passed as a Headers object', () => {
		const headers = new Headers({ cookie: 'nova_session=secret', accept: 'text/html' });
		expect(redact(headers)).toEqual({ cookie: REDACTED, accept: 'text/html' });
	});
});

describe('createLogger', () => {
	it('writes one JSON object per line', () => {
		const { logger, parsed } = capture();
		logger.info('request', { method: 'GET', path: '/', status: 200 });
		expect(parsed()).toEqual([
			{
				time: '2026-03-08T12:00:00.000Z',
				level: 'info',
				message: 'request',
				method: 'GET',
				path: '/',
				status: 200
			}
		]);
	});

	it('drops lines below the configured level', () => {
		const { logger, lines } = capture('info');
		logger.debug('quiet');
		logger.info('loud');
		expect(lines).toHaveLength(1);
	});

	it('redacts fields on the way out', () => {
		const { logger, parsed } = capture();
		logger.warn('sign-in failed', { email: 'a@b.test', password: 'hunter2' });
		expect(parsed()[0]).toMatchObject({ email: 'a@b.test', password: REDACTED });
	});

	it('never writes a session token, whatever it is called', () => {
		const { logger, lines } = capture();
		logger.error('boom', {
			cookies: { nova_session: 'tok_deadbeef' },
			form: { password: 'hunter2' },
			token: 'tok_deadbeef'
		});
		expect(lines.join('\n')).not.toContain('tok_deadbeef');
		expect(lines.join('\n')).not.toContain('hunter2');
	});

	it('keeps an error id findable in the line it logged', () => {
		const { logger, parsed } = capture();
		logger.error('unhandled error', {
			errorId: 'a1b2c3d4',
			error: serializeError(new Error('orbit collapsed'))
		});
		const line = parsed()[0];
		expect(line.errorId).toBe('a1b2c3d4');
		expect(line.error.message).toBe('orbit collapsed');
		expect(line.error.stack).toContain('orbit collapsed');
	});
});
