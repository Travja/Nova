import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The universe view (#11) with its renderer: the journey the spec's "done
 * when" describes, on a 390px phone, drawn by WebGL on SwiftShader.
 *
 * This file runs in its own Playwright project, `universe`, which is the only
 * one launched with SwiftShader's flags. `universe-view.spec.ts` beside it
 * covers the part that has to work with no JavaScript at all.
 *
 * A body is a few pixels across, so taps go through `window.__novaUniverse`, a
 * handle the renderer only installs in development, which says where on the
 * page a body is and how many frames have been drawn.
 */

const PHONE = { width: 390, height: 844 };
/** The universe chunk in development, where modules are served one by one. */
const RENDERER = /\/src\/lib\/universe\/|\/three[./]|\/three\//;

test.use({ viewport: PHONE });

test.beforeEach(async ({ context }) => {
	// A fresh narrow landing on `/` goes to `/today`; a pilot who chose the
	// dashboard keeps it for the session, which is what this says.
	await context.addInitScript(() => sessionStorage.setItem('nova:tiered-dashboard', '1'));
});

async function register(page: Page) {
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Universe Pilot');
	await page.getByLabel('Email').fill(`universe-journey-${Date.now()}@example.com`);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

/** A goal through the app's own form action, returning its id. */
async function launch(page: Page, title: string, tier: string, target: number): Promise<string> {
	const response = await page.request.post('/goals/new', {
		form: { title, tier, metricKind: 'count', metricUnit: '', target: String(target) },
		headers: { origin: new URL(page.url()).origin },
		maxRedirects: 0
	});
	const { location } = (await response.json()) as { location: string };
	return location.split('/').pop() ?? '';
}

async function post(page: Page, path: string, form: Record<string, string>) {
	await page.request.post(path, { form, headers: { origin: new URL(page.url()).origin } });
}

async function openUniverse(page: Page) {
	await page.goto('/');
	await hydrated(page);
	await expect(page.locator('.universe__view')).toHaveAttribute('data-state', 'ready');
	await settled(page);
}

/** No flight and no closing in progress, and a frame or two for the last of it to draw. */
async function settled(page: Page) {
	await page.waitForFunction(() => window.__novaUniverse?.settled() === true);
	await page.waitForTimeout(200);
}

async function frames(page: Page): Promise<number> {
	return page.evaluate(() => window.__novaUniverse?.frames() ?? -1);
}

async function tap(page: Page, id: string) {
	const at = await page.evaluate((target) => window.__novaUniverse?.where(target), id);
	expect(at, `${id} should be on screen`).toBeTruthy();
	await page.mouse.click(at!.x, at!.y);
}

test('switches to the universe, taps a body, logs from its sheet, zooms out and back, and switches back', async ({
	page
}) => {
	const renderer: string[] = [];
	page.on('request', (request) => {
		if (RENDERER.test(new URL(request.url()).pathname)) renderer.push(request.url());
	});

	await register(page);
	const reading = await launch(page, 'Read pages', 'satellite', 20);
	await launch(page, 'Weekly rhythm', 'planet', 3);
	await post(page, '/today?/addAsteroid', { title: 'Renew passport' });

	// The tiers view — the default — downloads none of the renderer.
	await page.goto('/');
	await hydrated(page);
	await expect(page.getByRole('button', { name: 'Tiers' })).toHaveAttribute('aria-pressed', 'true');
	await page.waitForLoadState('networkidle');
	expect(renderer, 'the tiers view requested the renderer').toEqual([]);

	// Switch. The toggle is enhanced, so this is the same page, re-rendered.
	await page.getByRole('button', { name: 'Universe' }).click();
	await expect(page.getByRole('button', { name: 'Universe' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const view = page.locator('.universe__view');
	await expect(view).toHaveAttribute('data-state', 'ready');
	expect(renderer.length, 'the universe view loaded its renderer').toBeGreaterThan(0);
	await settled(page);

	// The canvas is decorative and never a tab stop; the zoom opens at Home.
	const canvas = view.locator('canvas');
	await expect(canvas).toHaveAttribute('aria-hidden', 'true');
	await expect(canvas).not.toHaveAttribute('tabindex', /.*/);
	const zoom = page.getByRole('slider', { name: 'Zoom' });
	await expect(zoom).toHaveAttribute('aria-valuetext', 'Home');
	await expect(page.getByText('1 asteroid circles the home star.')).toBeVisible();

	// The bodies are alive — worlds turn, craft rock — but that is all that is
	// moving, so the loop draws it at half rate: never more than 30fps.
	const living = await frames(page);
	await page.waitForTimeout(1000);
	const drawn = (await frames(page)) - living;
	expect(drawn, 'living bodies drew no frames').toBeGreaterThan(0);
	expect(drawn, 'ambient motion ran faster than 30fps').toBeLessThanOrEqual(33);

	// Scrolled out of sight, the universe costs no frames at all. A short
	// window, so two goals' worth of list is enough to scroll past it.
	await page.setViewportSize({ width: PHONE.width, height: 420 });
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await expect
		.poll(async () => (await view.boundingBox())!.y + (await view.boundingBox())!.height)
		.toBeLessThan(0);
	await page.waitForTimeout(300);
	const hidden = await frames(page);
	await page.waitForTimeout(1000);
	expect(await frames(page), 'a universe out of sight drew frames').toBe(hidden);
	await page.setViewportSize(PHONE);
	await view.scrollIntoViewIfNeeded();
	await settled(page);

	// An axe pass over the view, the zoom and the list.
	const results = await new AxeBuilder({ page })
		.include('.universe')
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(results.violations.map((violation) => violation.id)).toEqual([]);

	// A tap on a body opens the list row's own sheet; log the whole target from it.
	await tap(page, reading);
	const sheet = page.getByRole('dialog', { name: /Read pages/ });
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText('Read pages');
	await sheet.getByLabel(/^Amount/).fill('20');
	await sheet.getByRole('button', { name: 'Log it' }).click();

	// The closing is the sheet's: it stays open, and the universe says it in words.
	await expect(page.locator('.universe [role="status"]')).toHaveText('Read pages closed its orbit');
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();

	// A closed orbit keeps circling, so now the loop runs on its own.
	await settled(page);
	const lapping = await frames(page);
	await page.waitForTimeout(500);
	expect(await frames(page), 'a closed body on screen stopped lapping').toBeGreaterThan(
		lapping + 5
	);

	// The zoom, from a keyboard: Home to Multiverse and back.
	await zoom.focus();
	await page.keyboard.press('End');
	await expect(zoom).toHaveAttribute('aria-valuetext', 'Multiverse');
	await page.keyboard.press('Home');
	await expect(zoom).toHaveAttribute('aria-valuetext', 'Home');

	// A rock opens the belt's own sheet, whose endings are Today's.
	await settled(page);
	const [rock] = await page.evaluate(() => window.__novaUniverse?.rocks() ?? []);
	await tap(page, rock);
	const rockSheet = page.getByRole('dialog', { name: /Renew passport/ });
	await expect(rockSheet).toBeVisible();
	await expect(rockSheet.getByRole('button', { name: /Done — finish this one/ })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(rockSheet).toBeHidden();

	// Keyboard focus on a row flies the camera there. From Multiverse the goal
	// is folded into its host's glow and not drawn at all; after the flight it
	// is framed in the middle of the view.
	const weeklyRow = page.locator('li[data-goal-id]', { hasText: 'Weekly rhythm' });
	const weekly = (await weeklyRow.getAttribute('data-goal-id'))!;
	await zoom.focus();
	await page.keyboard.press('End');
	await settled(page);
	expect(await page.evaluate((id) => window.__novaUniverse?.where(id), weekly)).toBeNull();
	await weeklyRow.getByRole('link').first().focus();
	await page.waitForTimeout(400);
	await settled(page);
	const framed = await page.evaluate((id) => window.__novaUniverse?.where(id), weekly);
	const box = (await view.boundingBox())!;
	expect(framed).toBeTruthy();
	expect(Math.abs(framed!.x - (box.x + box.width / 2))).toBeLessThan(box.width * 0.2);

	// A lost WebGL context stops the loop; a restored one draws the same tree again.
	await page.evaluate(() => {
		const context = document.querySelector('.universe canvas') as HTMLCanvasElement;
		const gl = context.getContext('webgl2') ?? context.getContext('webgl');
		(window as unknown as { __lose?: WEBGL_lose_context | null }).__lose =
			gl?.getExtension('WEBGL_lose_context');
		(window as unknown as { __lose?: WEBGL_lose_context | null }).__lose?.loseContext();
	});
	await expect(view).toHaveAttribute('data-state', 'lost');
	await page.evaluate(() =>
		(window as unknown as { __lose?: WEBGL_lose_context | null }).__lose?.restoreContext()
	);
	await expect(view).toHaveAttribute('data-state', 'ready');

	// And back to Tiers.
	await page.getByRole('button', { name: 'Tiers' }).click();
	await expect(page.getByRole('button', { name: 'Tiers' })).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.universe__view')).toHaveCount(0);
});

test('under reduced motion a closed orbit waits at its start mark and draws no frames', async ({
	browser
}) => {
	const context = await browser.newContext({ viewport: PHONE, reducedMotion: 'reduce' });
	await context.addInitScript(() => sessionStorage.setItem('nova:tiered-dashboard', '1'));
	const page = await context.newPage();

	await register(page);
	const flossing = await launch(page, 'Floss', 'satellite', 1);
	await post(page, '/?/log', { goalId: flossing, amount: '1' });
	await post(page, '/?/view', { view: 'universe' });

	await openUniverse(page);
	const before = await frames(page);
	await page.waitForTimeout(1000);
	expect(await frames(page), 'a closed body lapped under reduced motion').toBe(before);

	// The still universe still says everything: its sheet reads closed.
	await tap(page, flossing);
	await expect(page.getByRole('dialog', { name: /Floss/ })).toContainText(/closed/i);
	await context.close();
});

test('without WebGL the page is the list, with a sentence saying why', async ({ page }) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			kind: string,
			...rest: unknown[]
		) {
			if (kind.startsWith('webgl')) return null;
			return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
		} as typeof original;
	});

	await register(page);
	await launch(page, 'Read pages', 'satellite', 20);
	await post(page, '/?/view', { view: 'universe' });

	await page.goto('/');
	await hydrated(page);
	await expect(page.locator('.universe__view')).toHaveAttribute('data-state', 'failed');
	await expect(
		page.getByText("This device can't draw the universe — every goal is listed below.")
	).toBeVisible();
	await expect(page.locator('li[data-goal-id]', { hasText: 'Read pages' })).toBeVisible();
});

declare global {
	interface Window {
		__novaUniverse?: import('../src/lib/universe').UniverseProbe;
	}
}
