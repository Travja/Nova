import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The three M1 flows that turn stored-but-invisible data into something you can
 * actually use: archiving and restoring, backdating and editing entries, and
 * putting goals in the order you want them.
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

async function launchGoal(page: Page, title: string, tier = 'Satellite') {
	await page.goto('/goals/new');
	// The form's fields are bound, so filling them before hydration is undone.
	await hydrated(page);

	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: new RegExp(tier) }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('a goal can be archived with its streak frozen, then restored', async ({ page }) => {
	await register(page, 'Rhea Vance');
	await launchGoal(page, 'Water the plants');

	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();

	// Archiving says what it will do before it does it.
	await page.getByRole('link', { name: 'Archive', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Archive Water the plants?' })).toBeVisible();
	await expect(page.getByText('Every entry stays exactly where it is.')).toBeVisible();
	await expect(page.getByText(/streak freezes at 1 rather than breaking/)).toBeVisible();

	await page.getByRole('button', { name: 'Archive it' }).click();

	// It lands on the archive with its final numbers.
	await expect(page).toHaveURL(/\/goals\/archived$/);
	await expect(page.getByRole('link', { name: 'Water the plants' })).toBeVisible();
	await expect(page.getByText('Streak when archived').locator('..').getByText('1')).toBeVisible();

	// And it is gone from the dashboard.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Nothing in orbit yet' })).toBeVisible();

	await page.goto('/goals/archived');
	await page.getByRole('button', { name: 'Restore' }).click();
	await expect(page.getByText('Water the plants is back in orbit.')).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Water the plants' })).toBeVisible();
	// The streak survived the round trip rather than resetting to zero.
	await expect(page.getByText('Streak').first().locator('..').getByText('1')).toBeVisible();
});

test('an entry can be logged with its own timestamp and edited afterwards', async ({ page }) => {
	await register(page, 'Io Marsh');
	await launchGoal(page, 'Stretch', 'Planet');

	const when = page.getByLabel('When');
	await expect(when).toHaveAttribute('type', 'datetime-local');
	// The floor is the orbit the goal launched in; the ceiling is now plus a
	// little slack for a fast clock.
	await expect(when).toHaveAttribute('min', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
	await expect(when).toHaveAttribute('max', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
	const earliest = (await when.getAttribute('min'))!;

	// Log against the earliest moment this goal can accept.
	await page.getByLabel('Amount', { exact: true }).fill('2');
	await when.fill(earliest);
	await page.getByRole('button', { name: 'Log it' }).click();

	const entries = page.getByRole('listitem').filter({ hasText: 'check-ins' });
	await expect(entries.first()).toContainText('2 check-ins');

	// Editing that entry corrects the amount in place.
	// The hero has its own Edit link for the goal, so stay in the entries list.
	await page.locator('#entries').getByRole('link', { name: 'Edit' }).first().click();
	const editForm = page.locator('form.edit');
	await expect(editForm).toBeVisible();
	await editForm.getByLabel('Amount').fill('5');
	await page.getByRole('button', { name: 'Save entry' }).click();

	await expect(page.getByText('Entry updated.')).toBeVisible();
	await expect(page.getByRole('listitem').filter({ hasText: 'check-ins' }).first()).toContainText(
		'5 check-ins'
	);
});

test('goals can be reordered within a tier from the keyboard', async ({ page }) => {
	await register(page, 'Vega Cole');
	await launchGoal(page, 'Alpha');
	await launchGoal(page, 'Beta');

	await page.goto('/');
	await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Alpha', 'Beta']);

	// Hydrated before the move, so `use:enhance` is attached and this is the
	// keyboard route rather than a native post. The two announce differently —
	// the enhanced one says where the goal landed, which the server's reply
	// cannot know — and without this the test raced which of them it got.
	await hydrated(page);
	await page.getByRole('link', { name: 'Reorder' }).click();
	await page.getByRole('button', { name: 'Move Beta up' }).click();

	await expect(page.locator('ol.order a.title')).toHaveText(['Beta', 'Alpha']);
	// Where it landed, not just that it moved: the server's reply never knew the
	// position, so #7 moved the announcement into `GoalOrderList`, which does.
	// "moved within its tier" is still what a move with no JavaScript says.
	await expect(page.getByText('Beta moved to position 1 of 2 in Satellite.')).toBeVisible();

	// The new order is the dashboard's order, and it survives a reload.
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Beta', 'Alpha']);
});
