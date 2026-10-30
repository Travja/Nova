import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The universe view's renderer (#11): `src/lib/universe/` and three.js with it.
 * Its only way in is the dynamic `import()` in `Universe.svelte`'s `onMount`,
 * so the bundler already gives it a chunk of its own — three is imported
 * nowhere else to share it with. The chunk only needs a stable name, so the
 * service worker can tell it apart from every other chunk.
 */
const UNIVERSE_CHUNK = 'universe';
const UNIVERSE_ENTRY = /[\\/]src[\\/]lib[\\/]universe[\\/]index\.ts$/;

/**
 * Put that name in the file, which SvelteKit's enforced `chunkFileNames`
 * (`chunks/[hash].js`) leaves out for every chunk. Only the one chunk is
 * touched, and only in the client build: everything else keeps SvelteKit's
 * names exactly.
 */
function universeChunkName(): Plugin {
	return {
		name: 'nova:universe-chunk-name',
		apply: 'build',
		outputOptions(options) {
			const original = options.chunkFileNames;
			if (typeof original !== 'string' || !original.includes('/chunks/[hash].')) return null;
			return {
				...options,
				chunkFileNames: (chunk) =>
					chunk.facadeModuleId && UNIVERSE_ENTRY.test(chunk.facadeModuleId)
						? original.replace('[hash]', `${UNIVERSE_CHUNK}.[hash]`)
						: original
			};
		}
	};
}

export default defineConfig({
	plugins: [
		sveltekit(),
		universeChunkName(),
		SvelteKitPWA({
			registerType: 'prompt',
			injectRegister: 'auto',
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
				/*
				 * Cached on first use, not precached (#11, decision 1). Precaching it
				 * would have every install download three.js up front — including
				 * every pilot who never leaves the tiers view. The `CacheFirst` rule
				 * below keeps it once it has been seen online.
				 */
				globIgnores: [`**/${UNIVERSE_CHUNK}.*.js`],
				/*
				 * Reminders (#19), added to the generated worker rather than replacing
				 * it. `generateSW` already carries the precache, the Background Sync
				 * queue the offline log flushes through, and the `SKIP_WAITING`
				 * listener `UpdatePrompt.svelte` posts to; a custom worker would mean
				 * reimplementing all three, and the update prompt would fail silently
				 * if it were forgotten. One `importScripts` at the top of the worker
				 * keeps every one of them untouched.
				 */
				importScripts: ['/push-sw.js'],
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
						 * The universe chunk: fetched the first time the view mounts,
						 * then served from here, so the universe works offline once it
						 * has been seen online. The name carries a content hash, so a
						 * cached copy is never stale — a new build is a new URL.
						 */
						urlPattern: ({ url, sameOrigin }) =>
							sameOrigin && /\/_app\/immutable\/chunks\/universe\.[^/]+\.js$/.test(url.pathname),
						handler: 'CacheFirst',
						options: {
							cacheName: 'nova-universe',
							expiration: { maxEntries: 4 },
							cacheableResponse: { statuses: [200] }
						}
					},
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
