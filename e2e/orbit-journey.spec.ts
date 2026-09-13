import { expect, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The journey that has to keep working: sign up, launch a goal, log against it
 * and watch the orbit advance.
 */
test('a new pilot can register, launch a goal and close part of an orbit', async ({ page }) => {
	const email = `pilot-${Date.now()}@example.com`;

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Your goals, in orbit.' })).toBeVisible();

	await page.getByRole('link', { name: 'Start flying' }).first().click();
	await hydrated(page);
	await page.getByLabel('Name').fill('Test Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();

	// Registration drops straight into goal creation.
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	await hydrated(page);

	await page.getByLabel('What is the goal?').fill('Clean the house');
	await page.getByRole('radio', { name: /Planet/ }).check();
	await page.getByLabel('Measured in').selectOption('duration');
	await page.getByLabel(/Target per orbit/).fill('120');
	await page.getByRole('button', { name: 'Launch goal' }).click();

	await expect(page.getByRole('heading', { name: 'Clean the house' })).toBeVisible();
	await expect(page.getByText('2h to go this week.')).toBeVisible();

	// The quick-log chips are a breakdown of the goal itself, so a two-hour
	// target offers a half hour, an hour, and the whole thing.
	await page.getByRole('button', { name: '+30m' }).click();
	await expect(page.getByText('1h 30m to go this week.')).toBeVisible();

	// Anything the chips do not cover goes through the custom amount.
	await page.getByLabel(/Amount/).fill('15');
	await page.getByRole('button', { name: 'Log it' }).click();
	await expect(page.getByText('1h 15m to go this week.')).toBeVisible();
	await expect(page.getByText('45m / 2h')).toBeVisible();

	// The dashboard shows the same orbit.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Clean the house' })).toBeVisible();
	await expect(page.getByText('1h 15m left this week')).toBeVisible();
});

test('an orbit closes once the target is reached', async ({ page }) => {
	const email = `pilot-${Date.now()}-b@example.com`;

	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Streak Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();

	await hydrated(page);
	await page.getByLabel('What is the goal?').fill('Daily reading');
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();

	await page.getByRole('button', { name: '+1 check-in' }).click();

	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(page.getByText('Streak').locator('..').getByText('1')).toBeVisible();
});
