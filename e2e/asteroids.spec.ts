import { expect, type Page, test } from '@playwright/test';
import { EVENING, hydrated, pinClock } from './helpers';

/**
 * The belt: one-offs that never became a cycle.
 *
 * What is being tested here is mostly what an asteroid *is not*. It has no
 * tier, no target, no period and no streak, so none of the orbit machinery has
 * anything to say about one — and the two things it can do instead, clearing
 * and letting go, each have to be a single tap from the Today view.
 */

async function register(page: Page, name: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	// Registration drops straight into goal creation, which this suite skips.
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

/** Two taps: into the field, and Add. */
async function addAsteroid(page: Page, title: string) {
	await page.getByLabel('Add a one-off').fill(title);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(rock(page, title)).toBeVisible();
}

function belt(page: Page) {
	return page.locator('.belt');
}

/** One row on the belt. Each rock names itself three times — once in the row
    and once inside each of its two endings — so the row is what to match. */
function rock(page: Page, title: string) {
	return belt(page).getByRole('listitem').filter({ hasText: title });
}

test('a one-off is added, cleared and let go, without ever becoming an orbit', async ({ page }) => {
	await pinClock(page, EVENING);
	await register(page, 'Wren Achebe');

	await page.goto('/today');
	await hydrated(page);

	// The belt is there before anything is on it — it is the only place an
	// asteroid can be added, so it cannot be gated on already having one.
	await expect(belt(page).getByText('Nothing adrift.')).toBeVisible();

	await addAsteroid(page, 'Return the library books');
	await addAsteroid(page, 'Cancel the gym trial');
	await expect(belt(page).getByRole('heading', { name: 'The belt (2)' })).toBeVisible();

	// Each rock is drawn, and drawn as a rock: no dial, no arc, nothing that
	// suggests there is a revolution here to complete.
	await expect(belt(page).locator('svg.asteroid')).toHaveCount(2);
	await expect(belt(page).locator('.dial')).toHaveCount(0);

	// One tap to clear. Quieter than a closing orbit: a line, not a burst.
	await page.getByRole('button', { name: 'Clear Return the library books' }).click();
	await expect(belt(page).getByText('Cleared.')).toBeVisible();
	await expect(rock(page, 'Return the library books')).toHaveCount(0);

	// One tap to let go, on equal footing with clearing.
	await page.getByRole('button', { name: 'Release Cancel the gym trial' }).click();
	await expect(belt(page).getByText('Released.')).toBeVisible();

	// And released means gone from every list, not filed under a gentler name.
	await expect(belt(page).getByText('Nothing adrift.')).toBeVisible();
	await page.reload();
	await expect(rock(page, 'Cancel the gym trial')).toHaveCount(0);

	// Nothing an asteroid did reached the orbit machinery: three of them came
	// and went and this account has still never had a goal.
	await expect(page.getByRole('heading', { name: 'Nothing in orbit yet' })).toBeVisible();
	await expect(page.locator('.dial')).toHaveCount(0);
});

test('an asteroid captured into a goal is a goal like any other', async ({ page }) => {
	await pinClock(page, EVENING);
	await register(page, 'Idris Halvorsen');

	await page.goto('/today');
	await hydrated(page);
	await addAsteroid(page, 'Clean the garage');

	// The manual offer, available from the moment the rock exists rather than
	// only after Nova has counted to three.
	await belt(page).locator('details > summary').first().click();
	await page.getByRole('link', { name: 'This keeps coming back — make it a goal' }).click();

	await expect(page.getByRole('heading', { name: 'Capture into orbit' })).toBeVisible();
	await hydrated(page);
	// It arrives knowing its own title; what it never had is what this screen
	// is for.
	await expect(page.getByLabel('What is the goal?')).toHaveValue('Clean the garage');

	await page.getByRole('radio', { name: /Planet/ }).check();
	await page.getByLabel('Measured in').selectOption('count');
	await page.getByLabel(/Target per orbit/).fill('2');
	await page.getByLabel('Unit').fill('sessions');
	await page.getByRole('button', { name: 'Capture into orbit' }).click();

	// A goal, on its own page, indistinguishable from one launched directly.
	await expect(page.getByRole('heading', { name: 'Clean the garage' })).toBeVisible();
	await expect(page.locator('.dial').first()).toBeVisible();
	// The quick-log is enhanced, so a click landing mid-hydration is prevented
	// by Svelte without the handler that replaces it being attached yet.
	await hydrated(page);

	// It logs, it counts, and its orbit closes — all the things an asteroid
	// deliberately cannot do. The chip rather than the custom form below it:
	// the form posts the wall-clock time it was rendered with, which is the
	// machine's rather than the hour this spec pinned, and lands in the future.
	await page.getByRole('button', { name: '+2 sessions', exact: true }).click();
	await expect(page.getByText('Logged.')).toBeVisible();

	// Two of two: the orbit closes, and the Today view folds it away with its
	// ring intact — the reward no asteroid can earn.
	await page.goto('/today');
	const closed = page.locator('details').filter({ hasText: 'Closed (1)' });
	await expect(closed.getByRole('link', { name: /Clean the garage/ })).toBeVisible();

	// And the rock it came from has left the belt.
	await expect(belt(page).getByText('Nothing adrift.')).toBeVisible();
});

test('the third clear of the same one-off offers to make it a habit, once', async ({ page }) => {
	await pinClock(page, EVENING);
	await register(page, 'Sasha Delacroix');

	await page.goto('/today');
	await hydrated(page);

	// Twice is a coincidence: "renew the car registration" clears twice a year
	// for years and is never going to be a Planet.
	for (const pass of [1, 2]) {
		await addAsteroid(page, 'Water the plants');
		await page.getByRole('button', { name: 'Clear Water the plants' }).click();
		await expect(belt(page).getByText('Cleared.')).toBeVisible();
		expect(await belt(page).getByText('has cleared').count(), `pass ${pass}`).toBe(0);
	}

	// Three is a cadence, and the offer arrives inline on the clear itself —
	// where somebody is already looking at "done".
	await addAsteroid(page, 'Water the plants');
	await page.getByRole('button', { name: 'Clear Water the plants' }).click();
	await expect(belt(page).getByText('Water the plants has cleared 3 times')).toBeVisible();

	// Turned down, and not asked again on the next clear of the same title.
	await page.getByRole('button', { name: 'No, it is a one-off' }).click();
	await addAsteroid(page, 'Water the plants');
	await page.getByRole('button', { name: 'Clear Water the plants' }).click();
	await expect(belt(page).getByText('Cleared.')).toBeVisible();
	await expect(belt(page).getByText('has cleared')).toHaveCount(0);
});
