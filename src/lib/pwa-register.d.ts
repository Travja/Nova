/**
 * `vite-plugin-pwa` ships these types at `vite-plugin-pwa/svelte`, which is
 * what `/// <reference types="vite-plugin-pwa/svelte" />` in `app.d.ts` would
 * normally pull in. It is only a transitive dependency here, reached through
 * `@vite-pwa/sveltekit` — pnpm's strict linking does not expose it at the top
 * level the way a reference directive needs, and adding it directly would be
 * a new dependency — so the shape is declared here instead, matching that
 * package's own `svelte.d.ts` for the one virtual module Nova imports.
 */
declare module 'virtual:pwa-register/svelte' {
	import type { Writable } from 'svelte/store';

	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegisteredSW?: (
			swScriptUrl: string,
			registration: ServiceWorkerRegistration | undefined
		) => void;
		onRegisterError?: (error: unknown) => void;
	}

	export function useRegisterSW(options?: RegisterSWOptions): {
		needRefresh: Writable<boolean>;
		offlineReady: Writable<boolean>;
		updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
	};
}
