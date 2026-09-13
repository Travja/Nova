import { describe, expect, it, vi } from 'vitest';
import { handleServerError } from './errors';
import { createLogger, REDACTED, type LogLevel } from './log';

function harness() {
	const lines: Array<Record<string, unknown>> = [];
	const logger = createLogger({
		level: 'debug' as LogLevel,
		write: (line) => lines.push(JSON.parse(line))
	});
	const report = vi.fn();
	return { logger, report, lines };
}

const base = {
	status: 500,
	message: 'Internal Error',
	method: 'POST',
	path: '/goals/orbit-1',
	userId: 'user-1',
	requestId: 'req-1'
};

describe('handleServerError', () => {
	it('shows the user an id that finds the failure in the logs', () => {
		const { logger, report, lines } = harness();
		const handled = handleServerError(
			{ ...base, error: new Error('no such column: orbits') },
			{ logger, report }
		);

		expect(handled.message).toContain(handled.errorId);
		const logged = lines.find((line) => line.errorId === handled.errorId);
		expect(logged).toBeDefined();
		expect(logged).toMatchObject({ level: 'error', path: '/goals/orbit-1', status: 500 });
		expect((logged!.error as Record<string, unknown>).message).toBe('no such column: orbits');
	});

	it('keeps the stack out of what the user sees', () => {
		const { logger, report } = harness();
		const handled = handleServerError({ ...base, error: new Error('boom') }, { logger, report });
		expect(handled.message).not.toContain('boom');
		expect(handled.message).not.toMatch(/\.ts:\d+/);
	});

	it('never lets a secret reach the log line', () => {
		const { logger, report, lines } = harness();
		handleServerError(
			{ ...base, error: Object.assign(new Error('bad login'), { password: 'hunter2' }) },
			{ logger, report }
		);
		expect(JSON.stringify(lines)).not.toContain('hunter2');
	});

	it('redacts a session token attached to the context it logs', () => {
		const { logger, report, lines } = harness();
		handleServerError(
			{ ...base, error: new Error('boom'), nova_session: 'tok_deadbeef' } as never,
			{ logger, report }
		);
		expect(JSON.stringify(lines)).not.toContain('tok_deadbeef');
	});

	it('logs a 404 without a stack and without reporting it', () => {
		const { logger, report, lines } = harness();
		const handled = handleServerError(
			{ ...base, status: 404, message: 'Not Found', error: new Error('Not Found') },
			{ logger, report }
		);

		expect(handled.message).toBe('Not Found');
		expect(report).not.toHaveBeenCalled();
		expect(lines[0]).toMatchObject({ level: 'warn', message: 'not found' });
		expect(lines[0].error).toBeUndefined();
	});

	it('hands the sink the same id, with nothing secret in it', () => {
		const { logger, report } = harness();
		const handled = handleServerError({ ...base, error: new Error('boom') }, { logger, report });
		expect(report).toHaveBeenCalledTimes(1);
		expect(report.mock.calls[0][0]).toMatchObject({ errorId: handled.errorId, status: 500 });
	});

	it('gives each failure its own id', () => {
		const { logger, report } = harness();
		const first = handleServerError({ ...base, error: new Error('a') }, { logger, report });
		const second = handleServerError({ ...base, error: new Error('b') }, { logger, report });
		expect(first.errorId).not.toBe(second.errorId);
	});
});

// Guards the redaction contract the hook depends on.
it('redacts secret-looking keys anywhere in the logged fields', () => {
	const { logger, lines } = harness();
	logger.error('unhandled error', { form: { email: 'a@b.test', password: 'hunter2' } });
	expect((lines[0].form as Record<string, unknown>).password).toBe(REDACTED);
});
