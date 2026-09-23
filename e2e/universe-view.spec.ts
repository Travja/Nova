import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The universe view's toggle and list (#11) — the part that has to work
 * without any JavaScript at all: the toggle posts and reloads, and the
 * server-rendered list is the universe in words. The renderer itself, which
 * needs WebGL, is `universe-journey.spec.ts`, in a project of its own.
 *
 * Setting the account up — registering and nesting a goal under another — uses
 * an ordinary, hydrated page: `#parentId`'s options are filtered by the tier
 * radio through client-side reactivity (see `nested-orbits.spec.ts`), which is
 * not itself part of what this journey is testing. The toggle and the list are
 * then checked from a second, JavaScript-free context that carries the same
 * session, so the part this issue actually adds is the part proven to work
 * with no script running at all.
 */

async function register(page: Page) {
	const email = `universe-${Date.now()}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Universe Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launch(
	page: Page,
	options: { title: string; tier: RegExp; target: string; feeds?: string }
) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(options.title);
	await page.getByRole('radio', { name: options.tier }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill(options.target);

	if (options.feeds) {
		const option = page.locator('#parentId option', { hasText: options.feeds });
		await page.selectOption('#parentId', (await option.getAttribute('value')) ?? '');
	}

	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: options.title })).toBeVisible();
}

test('switches to Universe with JavaScript disabled, sees the nested tree, and switches back', async ({
	page,
	browser
}) => {
	await register(page);
	await launch(page, { title: 'Weekly rhythm', tier: /Planet/, target: '2' });
	await launch(page, {
		title: 'Daily reading',
		tier: /Satellite/,
		target: '1',
		feeds: 'Weekly rhythm'
	});

	// The same session, carried into a context with no JavaScript at all.
	const cookies = await page.context().cookies();
	const noScript = await browser.newContext({ javaScriptEnabled: false });
	await noScript.addCookies(cookies);
	const noScriptPage = await noScript.newPage();

	await noScriptPage.goto('/');

	// Tiers is the default: the ordinary grid, not the universe list.
	await expect(noScriptPage.getByRole('button', { name: 'Tiers' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(noScriptPage.locator('.universe__view')).toHaveCount(0);

	// Posting the toggle with no JavaScript is a full reload — decision 14's
	// "without JavaScript it posts and reloads" — and it lands back on `/`.
	await noScriptPage.getByRole('button', { name: 'Universe' }).click();
	expect(new URL(noScriptPage.url()).pathname).toBe('/');

	await expect(noScriptPage.getByRole('button', { name: 'Universe' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// No canvas without a script to draw it: a sentence says so, and the zoom
	// is there because the server renders it.
	await expect(
		noScriptPage.getByText('The universe needs JavaScript — every goal is listed below.')
	).toBeVisible();
	await expect(noScriptPage.locator('.universe__view canvas')).toHaveCount(0);

	// The list is the universe in words: the daily goal nests under the weekly
	// one it feeds, in its own `<ul>`, exactly as `$domain/universe` would draw
	// it as an orbit round its parent.
	const parentRow = noScriptPage.locator('li', { hasText: 'Weekly rhythm' }).first();
	await expect(parentRow.getByText('Weekly rhythm')).toBeVisible();
	const childRow = parentRow.locator('ul li', { hasText: 'Daily reading' });
	await expect(childRow).toBeVisible();

	// And back to Tiers, still with no JavaScript.
	await noScriptPage.getByRole('button', { name: 'Tiers' }).click();
	await expect(noScriptPage.getByRole('button', { name: 'Tiers' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(noScriptPage.locator('.universe__view')).toHaveCount(0);

	await noScript.close();
});
