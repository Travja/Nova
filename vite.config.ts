import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			registerType: 'prompt',
			injectRegister: 'auto',
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
				/*
				 * No navigation fallback, and not by omission.
				 *
				 * `@vite-pwa/sveltekit` defaults this to the app's base path, which
				 * generates `createHandlerBoundToURL('/')`. Nova is server-rendered
				 * with `adapter-node` and prerenders nothing, so `/` is not in the
				 * precache manifest — and binding a handler to a URL that is not
				 * precached throws while the worker is being evaluated, which means
				 * no worker at all: no precache, no update prompt, no background
				 * sync. `undefined` keeps the plugin from filling it in; navigations
				 * are served by the runtime route below instead.
				 */
				navigateFallback: undefined,
				runtimeCaching: [
					{
						/*
						 * Where the offline queue flushes, and the reason this stays on
						 * `generateSW` rather than a custom worker: Workbox's
						 * `backgroundSync` handler option is a queue that replays these
						 * POSTs after the tab has gone, and it needs no worker source of
						 * our own. A custom worker would also have to reimplement the
						 * `SKIP_WAITING` listener `UpdatePrompt.svelte` talks to, and
						 * nothing would fail loudly if it forgot.
						 *
						 * Replays are safe because every entry carries a client id the
						 * insert conflicts on — a replayed request cannot double-count.
						 */
						urlPattern: ({ url, request }) =>
							request.method === 'POST' && url.pathname === '/api/entries',
						method: 'POST',
						handler: 'NetworkOnly',
						options: {
							backgroundSync: {
								name: 'nova-entry-queue',
								// Minutes. Longer than any plausible stretch without signal,
								// and short enough that a month-old entry is not resurrected
								// into an orbit the user has long since written off.
								options: { maxRetentionTime: 7 * 24 * 60 }
							}
						}
					},
					{
						/*
						 * Pages, so a reload while offline still lands on Nova rather than
						 * the browser's dinosaur — the queue survives in IndexedDB, and
						 * the page it is drawn on has to survive too. `__data.json` is the
						 * same content for a client-side navigation.
						 *
						 * Network first, so nothing stale is ever preferred to the truth;
						 * the cache only answers when the network does not. It does mean a
						 * signed-in page sits in the cache on that device, which is the
						 * price of reloading offline at all.
						 */
						urlPattern: ({ url, request, sameOrigin }) =>
							sameOrigin &&
							request.method === 'GET' &&
							(request.mode === 'navigate' || url.pathname.endsWith('/__data.json')),
						handler: 'NetworkFirst',
						options: {
							cacheName: 'nova-pages',
							networkTimeoutSeconds: 5,
							expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
							cacheableResponse: { statuses: [200] }
						}
					}
				]
			},
			manifest: {
				name: 'Nova — Goal Tracking',
				short_name: 'Nova',
				description: 'Track your goals as orbits, from satellites to universes.',
				theme_color: '#0b0f2a',
				background_color: '#05060f',
				display: 'standalone',
				orientation: 'portrait',
				start_url: '/',
				scope: '/',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{
						src: '/icons/icon-maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				],
				shortcuts: [
					{
						name: 'Log progress',
						short_name: 'Log',
						description: 'Jump to what needs attention today and log against it.',
						url: '/today',
						icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
					},
					{
						name: 'New goal',
						short_name: 'New goal',
						description: 'Launch a new goal to track.',
						url: '/goals/new',
						icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
					}
				],
				share_target: {
					action: '/share',
					method: 'GET',
					params: {
						title: 'title',
						text: 'text',
						url: 'url'
					}
				},
				screenshots: [
					{
						src: '/screenshots/narrow-today.png',
						sizes: '390x844',
						type: 'image/png',
						form_factor: 'narrow',
						label: 'Today, with the orbits that need attention'
					},
					{
						src: '/screenshots/wide-dashboard.png',
						sizes: '1280x800',
						type: 'image/png',
						form_factor: 'wide',
						label: 'The dashboard, goals grouped by tier'
					}
				]
			}
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.ts'],
		environment: 'node'
	}
});
