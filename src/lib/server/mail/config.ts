/**
 * Where outgoing mail goes, decided entirely by the environment.
 *
 * Three shapes, in priority order: an outbox directory (files on disk, for
 * developing and for the end-to-end tests), an SMTP server, or nothing at all.
 * Nothing is the default — an instance that never sets `SMTP_HOST` sends no
 * mail and reaches no network, and the features that need mail say so plainly
 * rather than pretending to have sent something.
 */

export interface SmtpSettings {
	host: string;
	port: number;
	/** Implicit TLS on connect (port 465). Otherwise STARTTLS is negotiated. */
	secure: boolean;
	user: string | null;
	pass: string | null;
	from: string;
}

export interface OutboxSettings {
	directory: string;
	from: string;
}

export type MailConfig =
	| { kind: 'smtp'; smtp: SmtpSettings }
	| { kind: 'outbox'; outbox: OutboxSettings }
	| { kind: 'none' };

const DEFAULT_FROM = 'Nova <nova@localhost>';

function port(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function trimmed(value: string | undefined): string | null {
	const result = value?.trim();
	return result ? result : null;
}

export function readMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig {
	const from = trimmed(env.MAIL_FROM) ?? trimmed(env.SMTP_USER) ?? DEFAULT_FROM;

	// An explicit outbox wins over SMTP so a misconfigured dev machine cannot
	// mail a real person by accident.
	const directory = trimmed(env.MAIL_OUTBOX_DIR);
	if (directory) return { kind: 'outbox', outbox: { directory, from } };

	const host = trimmed(env.SMTP_HOST);
	if (!host) return { kind: 'none' };

	const number = port(env.SMTP_PORT, 587);
	return {
		kind: 'smtp',
		smtp: {
			host,
			port: number,
			// Port 465 is TLS from the first byte; everything else upgrades with
			// STARTTLS. `SMTP_SECURE` overrides for a server that disagrees.
			secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : number === 465,
			user: trimmed(env.SMTP_USER),
			pass: trimmed(env.SMTP_PASS),
			from
		}
	};
}

/**
 * The absolute URL to build links with.
 *
 * `ORIGIN` and nothing else: the request's own Host header is written by
 * whoever sent the request, and a reset link built from it would point wherever
 * an attacker liked. A missing `ORIGIN` in production means no link is sent.
 */
export function readOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
	const origin = trimmed(env.ORIGIN);
	if (origin) return origin.replace(/\/+$/, '');
	return env.NODE_ENV === 'production' ? null : 'http://localhost:5173';
}
