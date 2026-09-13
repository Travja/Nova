import { logger } from '$lib/server/log';
import { readMailConfig, type MailConfig, type OutboxSettings, type SmtpSettings } from './config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Sending mail, behind one method.
 *
 * Nova sends exactly one kind of message today, and the narrow interface is
 * what keeps the choice of transport — an SMTP relay, a directory of files, or
 * nothing — out of every caller.
 */

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
}

export interface Mailer {
	send(message: MailMessage): Promise<void>;
}

/** Thrown when a feature needs mail on an instance that has none configured. */
export class MailNotConfiguredError extends Error {
	constructor() {
		super('No mail transport is configured.');
		this.name = 'MailNotConfiguredError';
	}
}

class SmtpMailer implements Mailer {
	readonly #settings: SmtpSettings;
	/** Created on first use, then reused: one pool, not one connection per mail. */
	#transport: Promise<import('nodemailer').Transporter> | null = null;

	constructor(settings: SmtpSettings) {
		this.#settings = settings;
	}

	async send(message: MailMessage): Promise<void> {
		const transport = await (this.#transport ??= this.#connect());
		await transport.sendMail({
			from: this.#settings.from,
			to: message.to,
			subject: message.subject,
			text: message.text
		});
	}

	async #connect() {
		// Imported here so an instance that sends no mail never loads it.
		const { createTransport } = await import('nodemailer');
		const { host, port, secure, user, pass } = this.#settings;
		return createTransport({
			host,
			port,
			secure,
			// An unauthenticated relay on localhost is a normal way to run this.
			auth: user && pass ? { user, pass } : undefined,
			// STARTTLS is required rather than opportunistic: a relay that cannot
			// upgrade would otherwise carry the reset link in clear text.
			requireTLS: !secure
		});
	}
}

/**
 * Writes each message to a file instead of sending it. What `MAIL_OUTBOX_DIR`
 * turns on, for local development and for the end-to-end tests, which read the
 * link back out of the directory.
 */
class OutboxMailer implements Mailer {
	readonly #settings: OutboxSettings;

	constructor(settings: OutboxSettings) {
		this.#settings = settings;
	}

	async send(message: MailMessage): Promise<void> {
		await mkdir(this.#settings.directory, { recursive: true });
		const file = join(this.#settings.directory, `${Date.now()}-${randomUUID()}.txt`);
		const body = [
			`From: ${this.#settings.from}`,
			`To: ${message.to}`,
			`Subject: ${message.subject}`,
			'',
			message.text,
			''
		].join('\n');
		await writeFile(file, body, 'utf8');
	}
}

class NoMailer implements Mailer {
	async send(): Promise<void> {
		throw new MailNotConfiguredError();
	}
}

export function createMailer(config: MailConfig): Mailer {
	switch (config.kind) {
		case 'smtp':
			return new SmtpMailer(config.smtp);
		case 'outbox':
			return new OutboxMailer(config.outbox);
		default:
			return new NoMailer();
	}
}

const config = readMailConfig();

/** The transport this instance actually has. */
export const mailer: Mailer = createMailer(config);

/** Whether a feature that needs to send mail can expect it to arrive. */
export const mailConfigured = config.kind !== 'none';

/**
 * Send without making the caller wait or fail.
 *
 * Two reasons. An SMTP round trip is slow and the sign-in surface must answer
 * a known and an unknown address in the same breath, or the wait itself says
 * which addresses are registered. And a relay that is down should not turn a
 * password reset into a 500 — the failure belongs in the logs, where the
 * operator can see it.
 */
export function sendInBackground(message: MailMessage, context: Record<string, unknown>): void {
	void mailer.send(message).catch((error) => {
		logger.error('mail send failed', { ...context, error });
	});
}
