/**
 * Structured logging.
 *
 * One JSON object per line on stdout, which is what `docker compose logs`
 * collects and what every log shipper can parse. No dependency, no transport:
 * a self-hosted instance should not need a log service to be debuggable.
 *
 * Nothing here imports SvelteKit or the database, so it is usable from any
 * layer and testable without fixtures.
 */

import { randomBytes } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = '[redacted]';

/**
 * Field names whose values never reach the logs. Matched as substrings against
 * the key with punctuation stripped, so `nova_session`, `sessionToken` and
 * `Set-Cookie` all land on the list.
 *
 * Sessions are stored as a SHA-256 of the token precisely so that a leaked
 * database cannot impersonate anyone; logging the raw token would undo that.
 */
const SECRET_KEY_PARTS = [
	'password',
	'passphrase',
	'token',
	'secret',
	'cookie',
	'authorization',
	'apikey',
	'credential',
	'novasession'
];

const MAX_DEPTH = 4;
const MAX_STRING = 512;

function isSecretKey(key: string): boolean {
	const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
	return SECRET_KEY_PARTS.some((part) => normalized.includes(part));
}

export function serializeError(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		const serialized: Record<string, unknown> = {
			name: error.name,
			message: error.message,
			stack: error.stack
		};
		if (error.cause !== undefined) serialized.cause = serializeError(error.cause);
		return serialized;
	}
	return { name: 'NonError', message: String(error) };
}

/**
 * Deep-copies a value, replacing anything that looks like a secret and cutting
 * cycles, oversized strings and runaway nesting. Everything logged goes through
 * this, so a caller cannot leak a secret by passing a whole form body.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (value === null || value === undefined) return value;
	if (value instanceof Error) return redact(serializeError(value), depth, seen);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof URL) return value.pathname;

	const type = typeof value;
	if (type === 'string') {
		const text = value as string;
		return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
	}
	if (type === 'number' || type === 'boolean') return value;
	if (type === 'bigint') return (value as bigint).toString();
	if (type === 'function' || type === 'symbol') return undefined;

	if (depth >= MAX_DEPTH) return '[truncated]';
	if (seen.has(value as object)) return '[circular]';
	seen.add(value as object);

	if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

	const source =
		value instanceof Map
			? Object.fromEntries(value)
			: value instanceof Headers || value instanceof URLSearchParams
				? Object.fromEntries(value.entries())
				: (value as Record<string, unknown>);

	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(source)) {
		out[key] = isSecretKey(key) ? REDACTED : redact(entry, depth + 1, seen);
	}
	return out;
}

export type LogFields = Record<string, unknown>;

export interface Logger {
	debug(message: string, fields?: LogFields): void;
	info(message: string, fields?: LogFields): void;
	warn(message: string, fields?: LogFields): void;
	error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
	/** Lowest level that is emitted. Default `info`. */
	level?: LogLevel;
	/** `json` for one object per line, `pretty` for a readable dev line. */
	format?: 'json' | 'pretty';
	/** Where a line goes. Injectable so tests do not have to capture stdout. */
	write?: (line: string, level: LogLevel) => void;
	/** Injectable clock, for tests. */
	now?: () => Date;
}

function defaultWrite(line: string, level: LogLevel): void {
	if (level === 'error' || level === 'warn') console.error(line);
	else console.log(line);
}

function formatPretty(time: string, level: LogLevel, message: string, fields: LogFields): string {
	const rest = Object.entries(fields)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
		.join(' ');
	return `${time} ${level.toUpperCase().padEnd(5)} ${message}${rest ? ` ${rest}` : ''}`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
	const threshold = LEVEL_WEIGHT[options.level ?? 'info'];
	const format = options.format ?? 'json';
	const write = options.write ?? defaultWrite;
	const now = options.now ?? (() => new Date());

	function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
		if (LEVEL_WEIGHT[level] < threshold) return;
		const safe = redact(fields) as LogFields;
		const time = now().toISOString();
		const line =
			format === 'pretty'
				? formatPretty(time, level, message, safe)
				: JSON.stringify({ time, level, message, ...safe });
		write(line, level);
	}

	return {
		debug: (message, fields) => emit('debug', message, fields),
		info: (message, fields) => emit('info', message, fields),
		warn: (message, fields) => emit('warn', message, fields),
		error: (message, fields) => emit('error', message, fields)
	};
}

function levelFromEnv(value: string | undefined): LogLevel {
	return value && value in LEVEL_WEIGHT ? (value as LogLevel) : 'info';
}

/** The process-wide logger. `LOG_LEVEL` and `LOG_FORMAT` configure it. */
export const logger = createLogger({
	level: levelFromEnv(process.env.LOG_LEVEL),
	format: process.env.LOG_FORMAT === 'pretty' ? 'pretty' : 'json'
});

/** A short, quotable id for correlating a user-facing error with its log line. */
export function newTraceId(bytes = 8): string {
	return randomBytes(bytes).toString('hex');
}
