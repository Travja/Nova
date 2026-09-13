import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Closing an orbit is the one moment the app is built around, so it has to fire
 * when it happens and stay quiet every other time: on a re-render, on a second
 * log into an orbit that is already closed, and on coming back to a goal that
 * closed while you were somewhere else.
 */

async function launchDailyGoal(page: Page, title: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Celebrating Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();

	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await hydrated(page);
}

test('a closing orbit is celebrated once, and never again', async ({ page }) => {
	await launchDailyGoal(page, 'Daily reading');

	const burst = page.locator('.burst');
	await expect(burst).toHaveCount(0);

	await page.getByRole('button', { name: '+1 check-in' }).click();

	// The moment itself, and then it is gone of its own accord.
	await expect(burst).toBeAttached();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0, { timeout: 5_000 });

	// Logging again into an orbit that is already closed is not a closing.
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('2 check-ins logged')).toBeVisible();
	await expect(burst).toHaveCount(0);

	// Nor is walking away and coming back to it.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
	await expect(burst).toHaveCount(0);

	await page.getByRole('link', { name: 'Daily reading', exact: true }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0);

	// Nor is a reload, which is where the browser's memory of the orbit starts.
	await page.reload();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0);
});

test.describe('with reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('the quiet state change is the whole celebration', async ({ page }) => {
		await launchDailyGoal(page, 'Daily stretch');
		await page.getByRole('button', { name: '+1 check-in' }).click();

		// The orbit still closes, and still says so. The burst is in the markup and
		// draws nothing, so position and fill carry the whole change.
		await expect(page.getByText('Orbit closed today')).toBeVisible();
		await expect(page.locator('.burst')).toBeAttached();
		await expect(page.locator('.burst')).toBeHidden();
	});
});
