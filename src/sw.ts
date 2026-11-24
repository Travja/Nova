/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/*
 * Nova's service worker.
 *
 * Built by `@vite-pwa/sveltekit` with the `buildSW` strategy (vite.config.ts),
 * which bundles this file and replaces `self.__WB_MANIFEST` with the precache
 * list. Up to `@vite-pwa/sveltekit` 1.x the worker was Workbox's `generateSW`
 * output with `static/push-sw.js` added by `importScripts`; 2.x dropped
 * `importScripts` from `generateSW`, so the worker that used to be generated
 * is written out here instead, piece for piece:
 *
 * - the `SKIP_WAITING` listener `UpdatePrompt.svelte` posts to,
 * - the precache,
 * - the three runtime routes (the universe chunk, the offline queue's
 *   Background Sync replay, pages),
 * - and the reminders' push handlers, still in `static/push-sw.js`.
 *
 * Nothing fails loudly if one of these goes missing — the update prompt would
 * just never take effect — so `sw.test.ts` checks each one is still here.
 */

import { BackgroundSyncPlugin } from '@vite-pwa/workbox-swkit/background-sync';
import { CacheableResponsePlugin } from '@vite-pwa/workbox-swkit/cacheable-response';
import { ExpirationPlugin } from '@vite-pwa/workbox-swkit/expiration';
import { cleanupOutdatedCaches, precacheAndRoute } from '@vite-pwa/workbox-swkit/precaching';
import { registerRoute } from '@vite-pwa/workbox-swkit/routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from '@vite-pwa/workbox-swkit/strategies';

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/*
 * Reminders (#19): showing a push, and answering the tap. A static file rather
 * than part of this bundle, so it stays plain JavaScript that imports nothing.
 * It has to be pulled in while the worker is first evaluated, which is why it
 * comes first.
 */
self.importScripts('/push-sw.js');

/*
 * `registerType: 'prompt'`: a new worker waits until the page says so. The
 * page is `UpdatePrompt.svelte`, which posts this when the user taps Reload.
 */
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

/*
 * The app shell and static assets. There is deliberately no navigation
 * fallback (`createHandlerBoundToURL`): Nova is server-rendered and prerenders
 * nothing, so there is no precached page to fall back to, and binding to one
 * that is not precached throws while the worker is evaluated. Navigations are
 * served by the pages route below instead.
 */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

/*
 * The universe chunk (#11): cached on first use rather than precached, so an
 * install does not download three.js up front. The name carries a content
 * hash, so a cached copy is never stale — a new build is a new URL.
 */
registerRoute(
	({ url, sameOrigin }) =>
		sameOrigin && /\/_app\/immutable\/chunks\/universe\.[^/]+\.js$/.test(url.pathname),
	new CacheFirst({
		cacheName: 'nova-universe',
		plugins: [
			new ExpirationPlugin({ maxEntries: 4 }),
			new CacheableResponsePlugin({ statuses: [200] })
		]
	}),
	'GET'
);

/*
 * Where the offline queue flushes. Background Sync replays these POSTs after
 * the tab has gone; replays are safe because every entry carries a client id
 * the insert conflicts on, so a replayed request cannot double-count.
 */
registerRoute(
	({ url, request }) => request.method === 'POST' && url.pathname === '/api/entries',
	new NetworkOnly({
		plugins: [
			new BackgroundSyncPlugin('nova-entry-queue', {
				// Minutes. Longer than any plausible stretch without signal, and
				// short enough that a month-old entry is not resurrected into an
				// orbit the user has long since written off.
				maxRetentionTime: 7 * 24 * 60
			})
		]
	}),
	'POST'
);

/*
 * Pages, so a reload while offline still lands on Nova rather than the
 * browser's dinosaur — the queue survives in IndexedDB, and the page it is
 * drawn on has to survive too. `__data.json` is the same content for a
 * client-side navigation. Network first, so nothing stale is ever preferred to
 * the truth; the cache only answers when the network does not.
 */
registerRoute(
	({ url, request, sameOrigin }) =>
		sameOrigin &&
		request.method === 'GET' &&
		(request.mode === 'navigate' || url.pathname.endsWith('/__data.json')),
	new NetworkFirst({
		cacheName: 'nova-pages',
		networkTimeoutSeconds: 5,
		plugins: [
			new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 }),
			new CacheableResponsePlugin({ statuses: [200] })
		]
	}),
	'GET'
);
