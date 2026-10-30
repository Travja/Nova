import { expect, type Page, test } from '@playwright/test';
import { hydrated, pinClock } from './helpers';

/**
 * Rest days (#66): a Satellite that flies on weekdays is not owed on a
 * Saturday.
 *
 * The clock is pinned to the coming Saturday evening — a date, not an hour,
 * because the weekday is the whole point. Nothing is logged under the pinned
 * clock (writes keep the real one), so a date is safe here: the goals are
 * launched now, their schedule starts today, and Saturday is read from it.
 */

/** The coming Saturday at 21:00, today included, as `datetime-local` text. */
function comingSaturdayEvening(): string {
	const day = new Date();
	day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7));
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T21:00`;
}

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

async function launchSatellite(page: Page, title: string, restOn: string[] = []) {
	await page.goto('/goals/new');
	await hydrated(page);

	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');

	const flies = page.getByRole('group', { name: 'Flies on' });
	// Every day flies until told otherwise.
	await expect(flies.getByRole('checkbox')).toHaveCount(7);
	for (const day of restOn) await flies.getByRole('checkbox', { name: day }).uncheck();

	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('a weekday-only satellite is not owed on a Saturday', async ({ page }) => {
	await pinClock(page, comingSaturdayEvening());
	await register(page, 'Ama Mensah');
	await launchSatellite(page, 'Gym', ['Sat', 'Sun']);

	// The goal page says what the schedule is, and that today is a rest day.
	await expect(page.getByTestId('rest-days')).toHaveText('Rests on Sat, Sun.');
	await expect(page.getByText('Rest day — nothing is owed today.')).toBeVisible();

	await launchSatellite(page, 'Read');

	await page.goto('/today');
	await hydrated(page);

	// Only the everyday satellite is owed this Saturday evening.
	const owed = page.locator('ul.risk').getByRole('article');
	await expect(owed).toHaveCount(1);
	await expect(owed.first()).toContainText('Read');
	await expect(page.getByText('1 orbit is pending')).toBeVisible();

	// The resting one waits in the fold, where nothing is owed.
	const steady = page.locator('details').filter({ hasText: 'Flying steady (1)' });
	await steady.locator('summary').click();
	await expect(steady.getByRole('link', { name: /Gym/ })).toBeVisible();
	await expect(steady).toContainText('Rest day — nothing owed');
});

test('the schedule can be edited, and resting every day is refused', async ({ page }) => {
	await register(page, 'Tomas Ruiz');
	await launchSatellite(page, 'Stretch', ['Sun']);

	await page.getByRole('link', { name: 'Edit', exact: true }).click();
	await hydrated(page);

	const flies = page.getByRole('group', { name: 'Flies on' });
	await expect(flies.getByRole('checkbox', { name: 'Sun' })).not.toBeChecked();
	await expect(flies.getByRole('checkbox', { name: 'Mon' })).toBeChecked();

	for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
		await flies.getByRole('checkbox', { name: day }).uncheck();
	}
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Pick at least one day to fly.')).toBeVisible();

	// The refused save changed nothing, so the form is back to the saved
	// schedule. Resting Saturday too applies from tomorrow, and the goal page
	// says both what is in force today and what is coming.
	await hydrated(page);
	await expect(flies.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
	await flies.getByRole('checkbox', { name: 'Sat' }).uncheck();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByTestId('rest-days')).toHaveText(
		'Rests on Sun. From tomorrow: rests on Sat, Sun.'
	);
});
