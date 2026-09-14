import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Motion, starfield and contrast (#14) are ordinary entries in the same table
 * `density` already sits in, so they get the same guarantee: a save applies
 * to `<html>` immediately, with no navigation, and is still there on a fresh
 * load because it lives on the account rather than the browser.
 */

async function register(page: Page) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Amara Solis');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

/** Seconds implied by a computed `animation-duration`, whatever unit it printed in. */
function toSeconds(duration: string): number {
	return duration.endsWith('ms') ? parseFloat(duration) / 1000 : parseFloat(duration);
}

async function starfieldAnimating(page: Page): Promise<boolean> {
	const duration = await page.evaluate(() => {
		const layer = document.querySelector('.layer');
		return layer ? getComputedStyle(layer).animationDuration : null;
	});
	return duration !== null && toSeconds(duration) > 1;
}

test('starfield and contrast apply without a reload and survive a refresh', async ({ page }) => {
	await register(page);
	await page.goto('/settings');
	await hydrated(page);

	let navigations = 0;
	page.on('load', () => navigations++);

	await page.getByLabel('Starfield').selectOption('off');
	await page.getByLabel('Contrast').selectOption('high');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	// Applied to <html> the moment the save resolved — no navigation happened.
	expect(navigations).toBe(0);
	await expect(page.locator('html')).toHaveAttribute('data-starfield', 'off');
	await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
	await expect(page.locator('.starfield')).toBeHidden();

	// And it is the account's, not the tab's: a fresh load still has it, with
	// no flash of the default before it does, since `hooks.server.ts` stamps
	// it in before the first paint.
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-starfield', 'off');
	await expect(page.locator('html')).toHaveAttribute('data-contrast', 'high');
	await expect(page.locator('.starfield')).toBeHidden();
});

test('motion overrides or defers to the OS setting across all four values', async ({ page }) => {
	await register(page);

	// Whether the starfield keeps animating once each value is saved, under
	// each of the two OS settings a browser can report.
	const matrix: Record<string, { reduce: boolean; noPreference: boolean }> = {
		system: { reduce: false, noPreference: true },
		full: { reduce: true, noPreference: true },
		reduced: { reduce: false, noPreference: false },
		none: { reduce: false, noPreference: false }
	};

	for (const [motion, expected] of Object.entries(matrix)) {
		await page.goto('/settings');
		await hydrated(page);
		await page.getByLabel('Motion').selectOption(motion);
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-motion', motion);

		for (const [os, expectAnimating] of [
			['reduce', expected.reduce],
			['no-preference', expected.noPreference]
		] as const) {
			await page.emulateMedia({ reducedMotion: os });
			await page.reload();
			await hydrated(page);
			expect(await starfieldAnimating(page), `motion=${motion}, OS reduced-motion=${os}`).toBe(
				expectAnimating
			);
		}
	}
});
