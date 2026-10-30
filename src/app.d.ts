import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in user, or null for anonymous requests. */
			user: SessionUser | null;
			sessionToken: string | null;
			/**
			 * The instant this request is answered against — see
			 * `$lib/server/clock`. Every load that needs "now" reads this rather
			 * than calling `new Date()`, so one request cannot measure a goal
			 * against one clock and rank it against another, and a test can pin it.
			 */
			now: Date;
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
