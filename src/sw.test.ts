import { beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * `src/sw.ts` is a hand-written copy of what Workbox's `generateSW` used to
 * produce, and nothing fails loudly when a piece of a service worker goes
 * missing. This runs it against a stand-in `self` and stand-in Workbox modules
 * and checks every piece is still wired up.
 */

const routes: Array<{ match: (options: object) => boolean; handler: Strategy; method: string }> =
	[];

class Strategy {
	constructor(readonly options: Record<string, unknown> = {}) {}
}

/*
 * Plain records rather than `vi.fn()`: the worker runs once, in `beforeAll`,
 * and mock call history does not survive into the tests.
 */
const calls = {
	precached: [] as unknown[],
	cleanedUp: 0,
	imported: [] as string[],
	skippedWaiting: 0
};

vi.mock('@vite-pwa/workbox-swkit/precaching', () => ({
	precacheAndRoute: (entries: unknown) => calls.precached.push(entries),
	cleanupOutdatedCaches: () => calls.cleanedUp++
}));
vi.mock('@vite-pwa/workbox-swkit/routing', () => ({
	registerRoute: (match: (options: object) => boolean, handler: Strategy, method: string) =>
		routes.push({ match, handler, method })
}));
vi.mock('@vite-pwa/workbox-swkit/strategies', () => ({
	CacheFirst: class CacheFirst extends Strategy {},
	NetworkFirst: class NetworkFirst extends Strategy {},
	NetworkOnly: class NetworkOnly extends Strategy {}
}));
vi.mock('@vite-pwa/workbox-swkit/expiration', () => ({
	ExpirationPlugin: class ExpirationPlugin extends Strategy {}
}));
vi.mock('@vite-pwa/workbox-swkit/cacheable-response', () => ({
	CacheableResponsePlugin: class CacheableResponsePlugin extends Strategy {}
}));
vi.mock('@vite-pwa/workbox-swkit/background-sync', () => ({
	BackgroundSyncPlugin: class BackgroundSyncPlugin {
		constructor(
			readonly name: string,
			readonly options: object
		) {}
	}
}));

const manifest = [{ url: 'push-sw.js', revision: 'abc' }];
const listeners: Record<string, (event: { data: unknown }) => void> = {};
const fakeSelf = {
	__WB_MANIFEST: manifest,
	importScripts: (url: string) => calls.imported.push(url),
	skipWaiting: () => calls.skippedWaiting++,
	addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
		listeners[type] = listener;
	}
};

beforeAll(async () => {
	vi.stubGlobal('self', fakeSelf);
	await import('./sw');
});

const origin = 'https://nova.test';
const request = (path: string, method = 'GET', mode = 'cors') => ({
	url: new URL(path, origin),
	request: { method, mode },
	sameOrigin: true
});

describe('the service worker', () => {
	it('pulls in the push handlers', () => {
		expect(calls.imported).toEqual(['/push-sw.js']);
	});

	it('skips waiting when the update prompt asks it to, and only then', () => {
		listeners.message({ data: { type: 'SOMETHING_ELSE' } });
		expect(calls.skippedWaiting).toBe(0);
		listeners.message({ data: { type: 'SKIP_WAITING' } });
		expect(calls.skippedWaiting).toBe(1);
	});

	it('precaches the injected manifest and clears out old precaches', () => {
		expect(calls.precached).toEqual([manifest]);
		expect(calls.cleanedUp).toBe(1);
	});

	it('keeps the universe chunk cache-first once seen', () => {
		const route = routes.find((r) => r.match(request('/_app/immutable/chunks/universe.Ab1-x.js')));
		expect(route?.handler.constructor.name).toBe('CacheFirst');
		expect(route?.handler.options.cacheName).toBe('nova-universe');
		expect(routes.filter((r) => r.match(request('/_app/immutable/chunks/Ab1-x.js')))).toEqual([]);
	});

	it('queues entry posts for Background Sync replay', () => {
		const route = routes.find((r) => r.match(request('/api/entries', 'POST')));
		expect(route?.method).toBe('POST');
		expect(route?.handler.constructor.name).toBe('NetworkOnly');
		const [plugin] = route?.handler.options.plugins as Array<{ name: string }>;
		expect(plugin.name).toBe('nova-entry-queue');
	});

	it('serves pages network-first, so a reload offline still lands on Nova', () => {
		for (const r of [request('/today', 'GET', 'navigate'), request('/goals/__data.json')]) {
			const route = routes.find((candidate) => candidate.match(r));
			expect(route?.handler.constructor.name).toBe('NetworkFirst');
			expect(route?.handler.options.cacheName).toBe('nova-pages');
		}
	});
});
