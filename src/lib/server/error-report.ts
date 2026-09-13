/**
 * Optional error reporting to a sink you host yourself.
 *
 * Off unless `ERROR_REPORT_URL` is set. Nova is self-hosted; it should not
 * phone home, and it should not ship a vendor SDK that could start doing so
 * after an upgrade. The payload is a plain JSON POST, so anything that accepts
 * a webhook — GlitchTip, a Discord relay, a three-line handler of your own —
 * works without a dependency here.
 */
import { logger, redact } from '$lib/server/log';

export interface ErrorReport {
	errorId: string;
	requestId?: string;
	message: string;
	status: number;
	method: string;
	path: string;
	userId?: string;
	error: Record<string, unknown>;
}

const url = process.env.ERROR_REPORT_URL;
const token = process.env.ERROR_REPORT_TOKEN;
const TIMEOUT_MS = 5000;

export const errorReportingEnabled = Boolean(url);

/**
 * Fire-and-forget: a sink that is down or slow must never turn one failed
 * request into two, so the send is not awaited and its own failure is logged
 * once at warn level.
 */
export function reportError(report: ErrorReport): void {
	if (!url) return;

	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (token) headers.authorization = `Bearer ${token}`;

	fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			service: 'nova',
			time: new Date().toISOString(),
			...(redact(report) as Record<string, unknown>)
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	}).catch((cause) => {
		logger.warn('error report failed', { errorId: report.errorId, cause });
	});
}
