import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The focused view: what is at risk before its period closes, logged without
 * leaving the screen, with the closed ones folded away rather than dropped.
 */

async function register(page: Page, name: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	// Registration drops straight into goal creation.
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launchGoal(page: Page, title: string, tier: string, target: string) {
	await page.goto('/goals/new');
	// The form's fields are bound, so filling them before hydration is undone.
	await hydrated(page);

	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: new RegExp(tier) }).check();
	await page.getByLabel('Measured in').selectOption('count');
	await page.getByLabel(/Target per orbit/).fill(target);
	await page.getByLabel('Unit').fill('pages');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

/** The at-risk rows, in the order they are drawn. GoalCard is the only article. */
function riskRows(page: Page) {
	return page.getByRole('article');
}

function riskRow(page: Page, title: string) {
	return riskRows(page).filter({ hasText: title });
}

test('the today view ranks what is at risk, logs inline and folds the closed away', async ({
	page
}) => {
	await register(page, 'Nadia Okonkwo');
	await launchGoal(page, 'Read pages', 'Satellite', '5');
	await launchGoal(page, 'Push-ups', 'Satellite', '5');

	await page.getByRole('link', { name: 'Today' }).click();
	await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
	// The quick-log forms below post for real until `use:enhance` is attached,
	// which navigates away from the view this test is about.
	await hydrated(page);
	await expect(page.getByText('2 orbits need attention')).toBeVisible();

	// Both satellites close today and neither has moved, so the tie falls to the
	// order they were launched in.
	await expect(riskRows(page).first()).toContainText('Read pages');

	// Logging happens on the row: the view reloads itself, it does not navigate.
	await riskRow(page, 'Read pages').getByRole('button', { name: '+2 pages' }).click();
	await expect(page).toHaveURL(/\/today$/);
	await riskRow(page, 'Read pages').getByRole('button', { name: '+2 pages' }).click();
	await expect(riskRow(page, 'Read pages')).toContainText('1 page left today');

	// With four fifths of one target logged, the untouched goal is the urgent one.
	await expect(riskRows(page).first()).toContainText('Push-ups');

	// Closing an orbit moves it out of the list without hiding it.
	await riskRow(page, 'Read pages').getByRole('button', { name: '+1 page', exact: true }).click();
	await expect(page.getByText('1 orbit needs attention')).toBeVisible();
	await expect(riskRows(page)).toHaveCount(1);

	const closed = page.locator('details').filter({ hasText: 'Closed (1)' });
	await expect(closed.getByRole('link', { name: 'Read pages' })).toBeVisible();
	await expect(closed).toContainText('5 pages / 5 pages');
});

test('a goal with a whole year to run waits in the steady fold', async ({ page }) => {
	await register(page, 'Bo Lindqvist');
	await launchGoal(page, 'Daily stretch', 'Satellite', '5');
	await launchGoal(page, 'Finish the novel', 'Universe', '12');

	await page.goto('/today');

	// A yearly orbit is only ever within a day of closing on 31 December, so
	// nothing is owed on it today — but it is still reachable from here.
	await expect(riskRows(page)).toHaveCount(1);
	await expect(riskRows(page).first()).toContainText('Daily stretch');

	// Folded away rather than hidden: one tap opens it, with no JavaScript needed.
	const steady = page.locator('details').filter({ hasText: 'Flying steady (1)' });
	await steady.locator('summary').click();
	await expect(steady.getByRole('link', { name: 'Finish the novel' })).toBeVisible();
});

test('the pilot reacts to the week, and can be sent away and asked back', async ({ page }) => {
	await register(page, 'Rae Whitlock');
	await launchGoal(page, 'Read pages', 'Satellite', '10');

	await page.goto('/today');
	await hydrated(page);

	// Nothing logged with the day closing: out of time and well short of target.
	const mascot = page.locator('.mascot');
	await expect(mascot).toHaveAttribute('data-mood', 'adrift');
	await expect(mascot).toContainText('Read pages');

	// Half of it in, with the same day left: worth a nudge rather than a drift.
	await page.getByRole('button', { name: '+5 pages' }).first().click();
	await expect(mascot).toHaveAttribute('data-mood', 'alert');

	// And once it closes there is nothing left to ask for.
	await page.getByRole('button', { name: '+5 pages' }).first().click();
	await expect(mascot).toHaveAttribute('data-mood', 'resting');

	// Skippable, and the choice survives a reload.
	await page.getByRole('button', { name: 'Hide the pilot' }).click();
	await expect(mascot).toHaveCount(0);
	await page.reload();
	await hydrated(page);
	await expect(mascot).toHaveCount(0);

	await page.getByRole('button', { name: 'Bring the pilot back' }).click();
	await expect(mascot).toHaveAttribute('data-mood', 'resting');
});

test('a phone lands on the focused view, with the tiered dashboard one tap away', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });

	await register(page, 'Ines Marchetti');
	await launchGoal(page, 'Water the plants', 'Satellite', '1');

	await page.goto('/');
	await expect(page).toHaveURL(/\/today$/);

	// One tap back to the tiers, and that choice survives a reload.
	await page.getByRole('link', { name: 'All tiers' }).click();
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
});

test('a wide screen still lands on the tiered dashboard', async ({ page }) => {
	await register(page, 'Cai Ferreira');
	await launchGoal(page, 'Tidy the desk', 'Satellite', '1');

	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
});
