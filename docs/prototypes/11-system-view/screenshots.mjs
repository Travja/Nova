/**
 * Renders the #11 prototypes at phone width and writes the screenshots the spec
 * and its pull request show.
 *
 *   node docs/prototypes/11-system-view/screenshots.mjs
 *
 * `index.html` is the universe the spec settles on and loads three.js from the
 * CDN. Where the CDN is blocked, point THREE_DIR at an unpacked copy of the same
 * version and the script serves it instead:
 *
 *   npm pack three@0.170.0 && tar xzf three-0.170.0.tgz
 *   THREE_DIR=$PWD/package node docs/prototypes/11-system-view/screenshots.mjs
 *
 * `flat.html` is the flat SVG sky the spec explored first and set aside; its
 * screenshots are kept for the record.
 *
 * Uses the Playwright the repo already carries, and the preinstalled Chromium
 * when its own build is missing, the way `playwright.config.ts` does. WebGL
 * runs on SwiftShader in headless Chromium, which is slow and exact.
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../screenshots/11-system-view');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';

function executablePath() {
	if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
	if (existsSync(chromium.executablePath())) return undefined;
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
	if (!existsSync(root)) return undefined;
	const build = readdirSync(root).find((name) => /^chromium-\d+$/.test(name));
	return build ? join(root, build, 'chrome-linux', 'chrome') : undefined;
}

const universe = [
	{ name: 'universe-5', query: '?n=5' },
	{ name: 'universe-12', query: '?n=12' },
	{ name: 'universe-12-galaxy', query: '?n=12&view=galaxy' },
	{ name: 'universe-12-universe', query: '?n=12&view=universe' },
	{ name: 'universe-12-multiverse', query: '?n=12&view=all' },
	{ name: 'universe-12-focus', query: '?n=12&focus=m1' },
	{ name: 'universe-12-belt', query: '?n=12&view=belt&rock=asteroid-2' },
	{ name: 'universe-12-closing', query: '?n=12&closing=p3' },
	{ name: 'universe-12-still', query: '?n=12&motion=none' },
	{ name: 'universe-40', query: '?n=40' },
	{ name: 'universe-40-galaxy', query: '?n=40&view=galaxy' },
	{ name: 'universe-40-universe', query: '?n=40&view=universe' },
	{ name: 'universe-40-multiverse', query: '?n=40&view=all' }
];

const flat = [
	{ name: 'flat-5', query: '?n=5' },
	{ name: 'flat-12', query: '?n=12' },
	{ name: 'flat-12-flat', query: '?n=12flat' },
	{ name: 'flat-40', query: '?n=40' },
	{ name: 'flat-12-closing', query: '?n=12&closing=y1' },
	{ name: 'flat-12-still', query: '?n=12&motion=none' },
	{ name: 'flat-12-focus', query: '?n=12&focus=p1' },
	{ name: 'flat-40-full-list', query: '?n=40', fullPage: true }
];

const browser = await chromium.launch({
	executablePath: executablePath(),
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const context = await browser.newContext({
	viewport: { width: 390, height: 844 },
	deviceScaleFactor: 2
});

if (process.env.THREE_DIR) {
	await context.route(`${CDN}**`, (route) => {
		const path = route.request().url().slice(CDN.length);
		route.fulfill({
			body: readFileSync(join(process.env.THREE_DIR, path)),
			contentType: 'text/javascript',
			headers: { 'access-control-allow-origin': '*' }
		});
	});
}

async function shoot(file, scenes, ready) {
	for (const scene of scenes) {
		const tab = await context.newPage();
		tab.on('pageerror', (error) => console.error(scene.name, error.message));
		await tab.goto(pathToFileURL(join(here, file)).href + scene.query);
		const decided = await ready(tab);
		await tab.screenshot({
			path: join(out, `${scene.name}.png`),
			fullPage: scene.fullPage ?? false
		});
		console.log(scene.name.padEnd(24), JSON.stringify(decided));
		await tab.close();
	}
}

await shoot('index.html', universe, async (tab) => {
	await tab.waitForFunction(() => window.__universe, null, { timeout: 60_000 });
	await tab.waitForTimeout(400);
	return tab.evaluate(() => window.__universe);
});
if (!process.argv.includes('--universe-only')) {
	await shoot('flat.html', flat, (tab) => tab.evaluate(() => window.__sky));
}

await browser.close();
