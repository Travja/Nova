import type { SessionUser } from '$lib/server/auth/session';

declare global {
	namespace App {
		interface Locals {
			/** The signed-in user, or null for anonymous requests. */
			user: SessionUser | null;
			sessionToken: string | null;
		}
	}
}

export {};
