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

/**
 * Two taps: into the field, and Add.
 *
 * The add form navigates, so this waits for the new page to hydrate as well as
 * to render. The row is server-rendered and visible before Svelte takes over,
 * and a click that lands in that window gets the markup's own behaviour rather
 * than the enhancement's — which is correct of the app and confusing in a test.
 */
async function addAsteroid(page: Page, title: string) {
	await page.getByLabel('Add a one-off').fill(title);
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(rock(page, title)).toBeVisible();
	await hydrated(page);
}

function belt(page: Page) {
	return page.locator('.belt');
}

/** One row on the belt. Each rock names itself more than once — in the row and
    inside each of its controls — so the row is what to match. */
function rock(page: Page, title: string) {
	return belt(page).getByRole('listitem').filter({ hasText: title });
}

/**
 * Drag a row sideways with a synthetic pointer.
 *
 * Dispatched rather than driven through `page.mouse`, so the gesture carries a
 * touch pointer type and lands on the row's own handlers the way a thumb does.
 * The moves are stepped because the row only decides a drag is sideways once it
 * has travelled past its slop, and one jump from nowhere to everywhere never
 * gives it that chance.
 */
async function swipeRow(page: Page, title: string, dx: number) {
	const row = rock(page, title);
	const box = (await row.boundingBox())!;
	const y = box.y + box.height / 2;
	const from = dx > 0 ? box.x + 30 : box.x + box.width - 30;
	const at = (x: number) => ({
		pointerId: 7,
		pointerType: 'touch',
		isPrimary: true,
		clientX: x,
		clientY: y,
		button: 0,
		buttons: 1
	});

	await row.dispatchEvent('pointerdown', at(from));
	for (const step of [0.35, 0.7, 1]) {
		await row.dispatchEvent('pointermove', at(from + dx * step));
	}
	await row.dispatchEvent('pointerup', { ...at(from + dx), buttons: 0 });
}

/**
 * Open a row's disclosure and hand back the row, endings and all.
 *
 * The row carries no controls of its own — they are a swipe — so every ending a
 * test presses is the one a keyboard or a screen reader would reach, which is
 * the point of them still being there.
 */
async function endings(page: Page, title: string) {
	const row = rock(page, title);
	await row.locator('summary').click();
	return row;
}

async function chooseCompact(page: Page) {
	await page.goto('/settings');
	await hydrated(page);
	await page.getByLabel('Density').selectOption('compact');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();
}

test('a one-off is added, ticked off and let go, without ever becoming an orbit', async ({
	page
}) => {
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

	// Each rock is drawn, against the belt it drifted out of — and drawn as a
	// rock: no dial, no arc, nothing suggesting a revolution to complete.
	await expect(belt(page).locator('.asteroid')).toHaveCount(2);
	await expect(belt(page).locator('.asteroid .strip')).toHaveCount(2);
	await expect(belt(page).locator('.dial')).toHaveCount(0);

	// The row itself is a rock, a title and a drift. Its endings are a swipe,
	// and every one of them is also a plain button a tap away — which is what
	// anyone without a pointer, a script or a hand uses instead.
	const books = rock(page, 'Return the library books');
	await expect(books.getByRole('button')).toHaveCount(0);

	await (
		await endings(page, 'Return the library books')
	)
		.getByRole('button', { name: /^Done —/ })
		.click();
	await expect(belt(page).getByText('Done.', { exact: true })).toBeVisible();
	await expect(rock(page, 'Return the library books')).toHaveCount(0);

	// Finished is not gone: it settles back into the belt, in a fold of its own,
	// where a released one is in no list at all.
	const settled = belt(page).locator('details').filter({ hasText: 'Done (1)' });
	await settled.locator('summary').click();
	await expect(settled.getByText('Return the library books')).toBeVisible();
	await expect(settled.getByText('Done today')).toBeVisible();

	// Letting go is the other ending, on the same footing and in the same list.
	await hydrated(page);
	await (
		await endings(page, 'Cancel the gym trial')
	)
		.getByRole('button', { name: /^Release —/ })
		.click();
	await expect(belt(page).getByText('Released.')).toBeVisible();

	// And released means gone from every list, not filed under a gentler name —
	// including the Done fold, which the one that was finished is still in.
	await expect(belt(page).getByText('Nothing adrift.')).toBeVisible();
	await page.reload();
	await expect(rock(page, 'Cancel the gym trial')).toHaveCount(0);
	await expect(belt(page).locator('details').filter({ hasText: 'Done (1)' })).toBeVisible();
	await expect(belt(page)).not.toContainText('Cancel the gym trial');

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
	// only after Nova has counted to three — and worded as an offer, because on
	// the first one "this keeps coming back" is simply not true yet.
	await belt(page).locator('details > summary').first().click();
	await page.getByRole('link', { name: 'Make this a goal instead' }).click();

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

test('the third time the same one-off is done, Nova offers to make it a habit', async ({
	page
}) => {
	await pinClock(page, EVENING);
	await register(page, 'Sasha Delacroix');

	await page.goto('/today');
	await hydrated(page);

	// Twice is a coincidence: "renew the car registration" clears twice a year
	// for years and is never going to be a Planet.
	for (const pass of [1, 2]) {
		await addAsteroid(page, 'Water the plants');
		await (
			await endings(page, 'Water the plants')
		)
			.getByRole('button', { name: /^Done —/ })
			.click();
		await expect(belt(page).getByText('Done.', { exact: true })).toBeVisible();
		expect(await belt(page).getByText('has cleared').count(), `pass ${pass}`).toBe(0);
	}

	// Three is a cadence, and the offer arrives inline on the clear itself —
	// where somebody is already looking at "done".
	await addAsteroid(page, 'Water the plants');
	await (await endings(page, 'Water the plants')).getByRole('button', { name: /^Done —/ }).click();
	await expect(belt(page).getByText('Water the plants has cleared 3 times')).toBeVisible();

	// Turned down, and not asked again on the next clear of the same title.
	await page.getByRole('button', { name: 'No, it is a one-off' }).click();
	await addAsteroid(page, 'Water the plants');
	await (await endings(page, 'Water the plants')).getByRole('button', { name: /^Done —/ }).click();
	await expect(belt(page).getByText('Done.', { exact: true })).toBeVisible();
	await expect(belt(page).getByText('has cleared')).toHaveCount(0);
});

test('compact puts every ending into a sheet, the way a goal row does', async ({ page }) => {
	await pinClock(page, EVENING);
	await register(page, 'Mira Solberg');
	await chooseCompact(page);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/today');
	await hydrated(page);
	await addAsteroid(page, 'Return the library books');

	// The row is a rock, a title and a drift, and carries no controls at all.
	const row = rock(page, 'Return the library books');
	await expect(row.getByRole('button')).toHaveCount(0);

	// Everything it can do is a tap away, in a sheet rather than in the row —
	// and the sheet is a real dialog, so the page behind it is inert.
	await row.locator('summary').click();
	// Scoped to the band: the page carries the goal row's sheet as well.
	const sheet = belt(page).getByRole('dialog');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('heading', { name: 'Return the library books' })).toBeVisible();
	await expect(sheet.getByRole('link', { name: 'Make this a goal instead' })).toBeVisible();

	// Both endings, spelled out in the words the swipe stands for.
	await expect(sheet.getByRole('button', { name: /^Done —/ })).toBeVisible();
	await sheet.getByRole('button', { name: /^Release —/ }).click();
	await expect(belt(page).getByText('Released.')).toBeVisible();
	await expect(rock(page, 'Return the library books')).toHaveCount(0);
});

test('a row can be swiped: right to finish, and never left while it is fresh', async ({ page }) => {
	await pinClock(page, EVENING);
	await register(page, 'Ola Kristiansen');

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/today');
	await hydrated(page);
	await addAsteroid(page, 'Return the library books');
	await addAsteroid(page, 'Book the dentist');

	// Right is finishing, and it presses the same button a thumb would have.
	await swipeRow(page, 'Return the library books', 150);
	await expect(belt(page).getByText('Done.', { exact: true })).toBeVisible();
	await expect(rock(page, 'Return the library books')).toHaveCount(0);
	await expect(belt(page).locator('details').filter({ hasText: 'Done (1)' })).toBeVisible();

	// Left is letting go, which a rock added a minute ago is not offering — so
	// the gesture gives a little and answers with nothing, exactly as the row's
	// missing stone edge says it would.
	await hydrated(page);
	await swipeRow(page, 'Book the dentist', -150);
	await expect(rock(page, 'Book the dentist')).toBeVisible();
	await expect(belt(page).getByText('Released.')).toHaveCount(0);

	// And the gesture never turns the page sideways under itself.
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth
		)
	).toBe(false);
});
