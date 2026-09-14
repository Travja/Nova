import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Compact is a different shape, not the same one with less padding: the lists
 * become rows, and the quick-log that used to sit on every card moves into a
 * sheet the row opens. Logging has to survive that move — including the amount
 * no chip offers — and the row has to still be a link to the goal for anyone
 * the sheet never reaches.
 */

const PHONE = { width: 390, height: 844 };

async function register(page: Page) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Nadia Okonkwo');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launchGoal(page: Page, title: string, target: string) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('count');
	await page.getByLabel(/Target per orbit/).fill(target);
	await page.getByLabel('Unit').fill('pages');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

async function chooseCompact(page: Page) {
	await page.goto('/settings');
	await hydrated(page);
	await page.getByLabel('Density').selectOption('compact');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
}

/** The compact list rows. `GoalCard` is the only `article`, so it is not one. */
function rows(page: Page) {
	return page.locator('.row');
}

test('compact swaps the cards for rows and fits far more on a phone', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	for (const title of ['Read pages', 'Push-ups', 'Stretching', 'Water the plants']) {
		await launchGoal(page, title, '20');
	}

	await page.goto('/today');
	await hydrated(page);
	const cardHeight = (await page.getByRole('article').first().boundingBox())!.height;

	await chooseCompact(page);
	await page.goto('/today');
	await hydrated(page);

	// The cards are gone from the list; the rows are what is left.
	await expect(page.getByRole('article')).toHaveCount(0);
	await expect(rows(page)).toHaveCount(4);

	const rowHeight = (await rows(page).first().boundingBox())!.height;
	expect(rowHeight).toBeLessThan(cardHeight / 2);
	// Still a control, so still on the right side of the floor.
	expect(rowHeight).toBeGreaterThanOrEqual(44);

	// Every row fits on the screen at once, which is the whole point.
	const last = (await rows(page).last().boundingBox())!;
	expect(last.y + last.height).toBeLessThanOrEqual(PHONE.height);
});

test('a row opens a sheet that logs without leaving the list', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');
	await chooseCompact(page);

	await page.goto('/today');
	await hydrated(page);
	await expect(page.getByRole('button', { name: '+5 pages' })).toBeHidden();

	await rows(page).filter({ hasText: 'Read pages' }).click();

	// The sheet is the full card: the chips the row gave up are all here.
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('article')).toBeVisible();
	await expect(sheet.getByText('Streak')).toBeVisible();

	await sheet.getByRole('button', { name: '+5 pages' }).click();
	await expect(page.getByText('Logged.')).toBeVisible();

	// Logged in place: still on Today, still in the sheet, and the row behind it
	// has caught up.
	await expect(page).toHaveURL(/\/today$/);
	await expect(sheet).toBeVisible();
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	await expect(rows(page).filter({ hasText: 'Read pages' })).toContainText('15 pages left today');
});

test('the sheet closes on escape, and the row is a real link underneath it', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');
	await chooseCompact(page);

	await page.goto('/today');
	await hydrated(page);
	const row = rows(page).filter({ hasText: 'Read pages' });

	// The enhancement sits on top of an ordinary link to the goal, so anyone
	// without it — no JavaScript, no `<dialog>` — still gets there.
	await expect(row).toHaveAttribute('href', /^\/goals\/[\w-]+$/);

	await row.click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page).toHaveURL(/\/today$/);
});

test('the sheet logs an amount no chip offers, and stays put to show it', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');
	await chooseCompact(page);

	await page.goto('/today');
	await hydrated(page);
	await rows(page).filter({ hasText: 'Read pages' }).click();
	const sheet = page.getByRole('dialog');

	// Seven is not on a chip, which is the whole reason this box is here.
	await sheet.getByLabel(/^Amount/).fill('7');
	await sheet.getByLabel('Note').fill('On the train');
	await sheet.getByRole('button', { name: 'Log it' }).click();

	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('article')).toContainText('13 pages left today');
	// The box empties itself, so a second log does not repeat the first.
	await expect(sheet.getByLabel(/^Amount/)).toHaveValue('');

	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(rows(page).filter({ hasText: 'Read pages' })).toContainText('13 pages left today');
});

test('a rejected amount is answered inside the sheet, not behind it', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');
	await chooseCompact(page);

	await page.goto('/today');
	await hydrated(page);
	await rows(page).filter({ hasText: 'Read pages' }).click();
	const sheet = page.getByRole('dialog');

	await sheet.getByLabel(/^Amount/).fill('0');
	await sheet.getByRole('button', { name: 'Log it' }).click();

	// The page's own live region is behind the backdrop and no use here.
	await expect(sheet.getByRole('alert')).toContainText('zero');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('article')).toContainText('20 pages left today');
});

test('the sheet carries the detail a row has no room for', async ({ page }) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');
	await chooseCompact(page);

	await page.goto('/today');
	await hydrated(page);
	await rows(page).filter({ hasText: 'Read pages' }).click();
	const sheet = page.getByRole('dialog');

	// The tier the row gave up, what a full orbit asks, and the running total.
	await expect(sheet).toContainText('Satellite · one orbit per day');
	await expect(sheet.getByText('A full orbit')).toBeVisible();
	await expect(sheet.getByText('Logged in all')).toBeVisible();
	await expect(sheet.getByRole('heading', { name: 'Recent orbits' })).toBeVisible();
	// And a way out to the goal's own page, which is where backdating lives.
	await expect(sheet.getByRole('link', { name: 'Open goal' })).toHaveAttribute(
		'href',
		/^\/goals\/[\w-]+$/
	);
});
