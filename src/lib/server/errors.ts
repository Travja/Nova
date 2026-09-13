/**
 * Turning an unexpected error into something a user can quote back.
 *
 * Kept out of `hooks.server.ts` so the rule that matters — the id the user sees
 * is the id in the logs — is unit-testable without booting SvelteKit.
 */
import { reportError, type ErrorReport } from '$lib/server/error-report';
import { logger as defaultLogger, newTraceId, serializeError, type Logger } from '$lib/server/log';

export interface ErrorContext {
	error: unknown;
	/** HTTP status SvelteKit resolved for this failure. */
	status: number;
	/** SvelteKit's user-facing message, before the reference is appended. */
	message: string;
	method: string;
	path: string;
	userId: string | null;
	requestId?: string;
}

export interface ErrorDeps {
	logger?: Logger;
	report?: (report: ErrorReport) => void;
	newId?: () => string;
}

export interface HandledError {
	message: string;
	errorId: string;
}

export function handleServerError(context: ErrorContext, deps: ErrorDeps = {}): HandledError {
	const logger = deps.logger ?? defaultLogger;
	const report = deps.report ?? reportError;
	const errorId = (deps.newId ?? (() => newTraceId(4)))();

	const fields = {
		errorId,
		requestId: context.requestId,
		method: context.method,
		path: context.path,
		status: context.status,
		userId: context.userId
	};

	// A 404 is a fact about the request, not a fault: no stack, and no reason to
	// wake an error sink.
	if (context.status === 404) {
		logger.warn('not found', fields);
		return { message: context.message, errorId };
	}

	const error = serializeError(context.error);
	logger.error('unhandled error', { ...fields, error });
	report({ ...fields, userId: context.userId ?? undefined, message: context.message, error });

	return { message: `${context.message} (reference ${errorId})`, errorId };
}
