import { sveltekit } from '@sveltejs/kit/vite';
import { LegacySvelteKitPWA } from '@vite-pwa/sveltekit/legacy';
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
		/*
		 * `LegacySvelteKitPWA` is `@vite-pwa/sveltekit` 2's plugin for SvelteKit 2:
		 * it sits beside `sveltekit()` and leaves `svelte.config.js` where it is.
		 * Its `withPwa` wrapper is the SvelteKit 3 way, and takes the Svelte config
		 * in here instead — the move to make along with SvelteKit 3.
		 */
		LegacySvelteKitPWA({
			registerType: 'prompt',
			/*
			 * `UpdatePrompt.svelte` registers `/sw.js` itself, so the plugin has no
			 * registration script to generate.
			 */
			injectRegister: false,
			/*
			 * The worker is `src/sw.ts`, bundled by the plugin with the precache list
			 * injected. It used to be Workbox's `generateSW` output with
			 * `static/push-sw.js` added through `importScripts`, but
			 * `@vite-pwa/sveltekit` 2 dropped that option, so the generated worker —
			 * precache, runtime routes, Background Sync queue and the `SKIP_WAITING`
			 * listener — is now written out in `src/sw.ts` itself.
			 */
			strategies: 'buildSW',
			buildSW: {
				swSrc: 'src/sw.ts',
				/*
				 * Relative to SvelteKit's output directory. Naming `client/` keeps the
				 * plugin from adding its own overlapping `client/**` pattern, which
				 * would list every file in the precache twice.
				 */
				globPatterns: ['client/**/*.{js,css,html,svg,png,webmanifest}'],
				/*
				 * Cached on first use, not precached (#11, decision 1). Precaching it
				 * would have every install download three.js up front — including
				 * every pilot who never leaves the tiers view. The `CacheFirst` route
				 * in `src/sw.ts` keeps it once it has been seen online.
				 */
				globIgnores: [`**/${UNIVERSE_CHUNK}.*.js`],
				/*
				 * The plugin always adds `prerendered/**` to the patterns, and Nova
				 * prerenders nothing. Workbox 8 fails the build on a pattern that
				 * matches no files unless this is off; Workbox 7 never did.
				 */
				globStrict: false
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
