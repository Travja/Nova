import { expect, type Page, test } from '@playwright/test';
import { EVENING, hydrated, pinClock } from './helpers';

/**
 * The primary action, where a thumb can reach it.
 *
 * Creating a goal moved out of the masthead on a phone and into a floating
 * button. The two must never both be on screen, and the button must never be
 * sitting on top of the last thing in the list underneath it.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

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

/** The floating control, whichever way it is being asked about. */
function floatingAdd(page: Page) {
	return page.locator('.quick-add');
}

function headerAdd(page: Page) {
	return page.getByRole('navigation').getByRole('link', { name: 'New goal' });
}

test('a phone gets one thumb-reachable tap to a new goal, and the header gives its slot up', async ({
	page
}) => {
	await page.setViewportSize(PHONE);
	await register(page);
	await launchGoal(page, 'Read pages', '20');

	await page.goto('/today');
	await hydrated(page);

	// Exactly one of the two, never both.
	await expect(headerAdd(page)).toBeHidden();
	await expect(floatingAdd(page)).toBeVisible();

	// A link with a real name, in the focus order — not a glyph a screen reader
	// has to guess at.
	const add = page.getByRole('link', { name: 'New goal' });
	await add.focus();
	await expect(add).toBeFocused();

	await add.click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	// Nothing floating on the page it would have navigated to.
	await expect(floatingAdd(page)).toBeHidden();
});

test('the floating button never sits on the last row of a list', async ({ page }) => {
	await page.setViewportSize(PHONE);
	// A full at-risk list is the layout this is about, and that is an evening:
	// the goals below are only drawn as cards while they are running out of time.
	await pinClock(page, EVENING);
	await register(page);
	// Enough cards that Today scrolls and has a genuine last row.
	for (const title of ['Read pages', 'Push-ups', 'Stretching', 'Water the plants']) {
		await launchGoal(page, title, '20');
	}

	// A narrow screen sends a fresh landing on `/` to the focused view, and that
	// redirect would reset the scroll under the measurement below. Reaching the
	// dashboard deliberately is what turns it off, which is what the `All tiers`
	// link does; do the same thing here rather than race it.
	await page.goto('/today');
	await hydrated(page);
	await page.getByRole('link', { name: 'All tiers' }).click();
	await expect(page).toHaveURL(/\/$/);

	for (const path of ['/today', '/', '/goals/archived']) {
		await page.goto(path);
		await hydrated(page);
		await expect(floatingAdd(page)).toBeVisible();

		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		// Measure only once the page has actually come to rest at the bottom.
		await expect
			.poll(() =>
				page.evaluate(
					() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
				)
			)
			.toBe(true);

		const button = await floatingAdd(page).boundingBox();
		expect(button, `no floating button on ${path}`).not.toBeNull();

		// Whatever the last row of this page turns out to be — a goal card, a
		// disclosure, an archived row — rather than a guess per page. The whole
		// shell rather than just `main`, because the footer sits below the last
		// list and is just as capable of ending up under the button; measuring
		// only `main` passes with no clearance at all, on the footer's own
		// padding.
		const lowest = await page.evaluate(() => {
			let bottom = 0;
			for (const element of document.querySelectorAll('.shell *')) {
				// The button itself lives in the shell now — #7 moved it there so it
				// sits in the focus order after the nav it replaces rather than after
				// the footer. It is fixed to the viewport either way, so it is still
				// floating over the content; it is just no longer outside the thing
				// being measured, and measuring it against itself always fails.
				if (element.closest('.quick-add')) continue;
				const box = element.getBoundingClientRect();
				if (box.width > 0 && box.height > 0) bottom = Math.max(bottom, box.bottom);
			}
			return bottom;
		});

		// Both are viewport-relative, so the content has to finish above where
		// the button starts.
		expect(lowest, `the floating button covers the end of ${path}`).toBeLessThanOrEqual(button!.y);
	}
});

test('a wide screen keeps the action in the header and floats nothing', async ({ page }) => {
	await page.setViewportSize(DESKTOP);
	await register(page);
	await launchGoal(page, 'Read pages', '20');

	await page.goto('/today');
	await hydrated(page);

	await expect(headerAdd(page)).toBeVisible();
	await expect(floatingAdd(page)).toBeHidden();
});
