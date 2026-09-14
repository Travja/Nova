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
				globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}']
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
