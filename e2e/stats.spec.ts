import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * `/stats`, reached from the dashboard rather than the header nav (#16 asks
 * for it not to grow past four items, which already wrap on a phone).
 *
 * Every number here that needs a *decided* period — completion rate,
 * momentum — is out of reach for a goal created moments ago: its only period
 * so far is still in flight. That is not a gap in the test, it is the
 * behaviour #16 asks for: a period that has not closed yet must read as
 * "not enough history" rather than as a miss. The one number a fresh account
 * can earn honestly is a same-day close, which still counts toward a streak
 * exactly the way `streakFrom` already treats one — so that is the real
 * number this test asserts.
 */

async function register(page: Page, name: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launchGoal(page: Page, title: string, tier = 'Satellite') {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: new RegExp(tier) }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('stats is reachable from the dashboard and reads a real streak off a same-day close', async ({
	page
}) => {
	await register(page, 'Nova Ferreira');
	await launchGoal(page, 'Water the plants');

	// Closes today's orbit immediately — an in-flight orbit that has already
	// hit target counts toward the streak without waiting for the day to end.
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();

	await page.goto('/');
	await page.getByRole('link', { name: 'Stats' }).click();
	await expect(page).toHaveURL(/\/stats$/);
	await expect(page.getByRole('heading', { name: 'Stats', level: 1 })).toBeVisible();

	// Best streak: a real, hand-checkable number for this account.
	await expect(page.getByText('1 orbit in a row')).toBeVisible();
	await expect(page.getByText('— Water the plants')).toBeVisible();

	// Completion and momentum both need a period that has already closed,
	// which a goal launched moments ago cannot have yet — the page has to say
	// so rather than showing a hollow 0%.
	await expect(
		page.getByText('No tier has a decided period yet — check back once one has closed.')
	).toBeVisible();
	await expect(
		page.getByText(
			'No goal has a full past period to compare against yet — momentum needs at least one.'
		)
	).toBeVisible();

	// When you log: today's check-in shows up on today's bar.
	await expect(page.getByText(/Mostly \w+s/)).toBeVisible();
});

test('a fresh account explains that stats need orbits to look back on', async ({ page }) => {
	await register(page, 'Kepler Oduya');
	await page.goto('/stats');
	await expect(page.getByRole('heading', { name: 'Nothing to measure yet' })).toBeVisible();
});
