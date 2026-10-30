import { expect, type Page, test } from '@playwright/test';
import { hydrated, pinClock } from './helpers';

/**
 * #67: a goal with an end flies until its last period is over, then lands in
 * the hangar with its record — and a later end brings it back, with the time
 * it spent landed counted as missed.
 *
 * The clock is pinned to a date well past the end to read the finished goal.
 * Writes keep the ordinary clock (see `$lib/server/clock`), so everything
 * logged here is logged today, and the extension is a date the real clock
 * also accepts.
 */

/** Denver, so the journey crosses the 1 November fall-back whenever it runs in autumn. */
test.use({ timezoneId: 'America/Denver' });

async function register(page: Page) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Landing Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

/** Today in the browser's zone, which is the zone the account was registered in. */
async function today(page: Page): Promise<string> {
	return page.evaluate(() => new Date().toLocaleDateString('en-CA'));
}

/** A `YYYY-MM-DD` some days on. Calendar arithmetic only; no instant is formed. */
function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function launchChallenge(page: Page, title: string, ends: string, endsOn?: string) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByLabel('Ends').selectOption(ends);
	if (endsOn) await page.getByLabel(/Last day/).fill(endsOn);
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await hydrated(page);
}

test('a 30-day challenge lands with its record, and a later end brings it back', async ({
	page
}) => {
	await register(page);
	const start = await today(page);
	await launchChallenge(page, 'Sober October', 'After 30 days');

	await expect(page.getByText(/last day/)).toBeVisible();
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	const goalUrl = page.url();

	// Forty days on, the challenge is over.
	await pinClock(page, `${addDays(start, 40)}T12:00`);

	// It has left every active surface…
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Nothing in orbit yet' })).toBeVisible();
	await page.goto('/today');
	await expect(page.getByRole('link', { name: 'Sober October' })).toHaveCount(0);

	// …and landed in the hangar with its record: one of thirty orbits closed.
	await page.goto('/goals/archived');
	await expect(page.getByRole('heading', { name: 'Hangar', level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Finished goals' })).toBeVisible();
	await expect(page.getByText('1 of 30')).toBeVisible();
	await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0);

	// Its own page is the closing card, and the landing is a moment exactly once.
	await page.goto(goalUrl);
	await expect(page.getByRole('heading', { name: 'Landed' })).toBeVisible();
	await expect(page.getByText('Finished — this was its final orbit.')).toBeVisible();
	await expect(page.locator('.burst')).toBeAttached();
	await expect(page.getByRole('heading', { name: 'Log progress' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Archive', exact: true })).toHaveCount(0);
	await expect(page.locator('.burst')).toHaveCount(0, { timeout: 5_000 });

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Landed' })).toBeVisible();
	await hydrated(page);
	await expect(page.locator('.burst')).toHaveCount(0);

	// A later end brings it back.
	await page.getByRole('link', { name: 'Extend' }).click();
	await expect(page.getByRole('heading', { name: 'Adjust the orbit' })).toBeVisible();
	await hydrated(page);
	await page.getByLabel('Ends').selectOption('On a date…');
	await page.getByLabel(/Last day/).fill(addDays(start, 60));
	await page.getByRole('button', { name: 'Save changes' }).click();

	await expect(page.getByRole('heading', { name: 'Log progress' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Landed' })).toHaveCount(0);
	// The ten days it spent landed were missed, not dormant: the streak broke.
	await expect(
		page.getByText('Streak', { exact: true }).locator('..').getByText('0')
	).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Sober October' })).toBeVisible();
});

test('an end in the past is refused, and the last orbit says it is the last', async ({ page }) => {
	await register(page);
	const start = await today(page);

	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill('Yesterday');
	// A daily goal, so yesterday is a period that is already over.
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Ends').selectOption('On a date…');
	await page.getByLabel(/Last day/).fill(addDays(start, -1));
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByText(/already decided/)).toBeVisible();

	await launchChallenge(page, 'Last call', 'On a date…', start);
	await expect(page.getByText('This is the last orbit it flies.')).toBeVisible();
});
