import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in user, or null for anonymous requests. */
			user: SessionUser | null;
			sessionToken: string | null;
			/** Correlates every log line written while handling this request. */
			requestId: string;
		}

		interface Error {
			message: string;
			/** Quotable id; the matching log line carries the detail. */
			errorId?: string;
		}
	}
}

export {};
