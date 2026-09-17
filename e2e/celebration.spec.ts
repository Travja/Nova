import { expect, type Page, test } from '@playwright/test';
import { EVENING, hydrated, pinClock } from './helpers';

/**
 * Closing an orbit is the one moment the app is built around, so it has to fire
 * when it happens and stay quiet every other time: on a re-render, on a second
 * log into an orbit that is already closed, and on coming back to a goal that
 * closed while you were somewhere else.
 */

async function launchDailyGoal(page: Page, title: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Celebrating Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();

	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await hydrated(page);
}

test('a closing orbit is celebrated once, and never again', async ({ page }) => {
	await launchDailyGoal(page, 'Daily reading');

	const burst = page.locator('.burst');
	await expect(burst).toHaveCount(0);

	await page.getByRole('button', { name: '+1 check-in' }).click();

	// The moment itself, and then it is gone of its own accord.
	await expect(burst).toBeAttached();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0, { timeout: 5_000 });

	// Logging again into an orbit that is already closed is not a closing.
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('2 check-ins logged')).toBeVisible();
	await expect(burst).toHaveCount(0);

	// Nor is walking away and coming back to it.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
	await expect(burst).toHaveCount(0);

	await page.getByRole('link', { name: 'Daily reading', exact: true }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0);

	// Nor is a reload, which is where the browser's memory of the orbit starts.
	await page.reload();
	await expect(page.getByText('Orbit closed today')).toBeVisible();
	await expect(burst).toHaveCount(0);
});

test.describe('with reduced motion', () => {
	test.use({ reducedMotion: 'reduce' });

	test('the quiet state change is the whole celebration', async ({ page }) => {
		await launchDailyGoal(page, 'Daily stretch');
		await page.getByRole('button', { name: '+1 check-in' }).click();

		// The orbit still closes, and still says so. The burst is in the markup and
		// draws nothing, so position and fill carry the whole change.
		await expect(page.getByText('Orbit closed today')).toBeVisible();
		await expect(page.locator('.burst')).toBeAttached();
		await expect(page.locator('.burst')).toBeHidden();
	});
});

/**
 * #51: closing an orbit from `/today` used to throw the whole moment away.
 * Compact draws the closing goal's sheet as a modal `<dialog>` inside a
 * `GoalRow`, and the row used to be destroyed the instant the goal moved from
 * the pending list to the Closed fold — taking the open dialog with it before
 * `noteOrbits`'s `SWEEP_MS` wait ever raised anything to see.
 */
test.describe('closing from the sheet on /today', () => {
	async function chooseCompact(page: Page) {
		await page.goto('/settings');
		await hydrated(page);
		await page.getByLabel('Density').selectOption('compact');
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
	}

	test('the dialog survives the goal moving to Closed, and the dial bursts inside it', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await pinClock(page, EVENING);
		await launchDailyGoal(page, 'Evening stretch');
		await chooseCompact(page);

		await page.goto('/today');
		await hydrated(page);

		const row = page.locator('.row').filter({ hasText: 'Evening stretch' });
		await row.click();
		const sheet = page.getByRole('dialog');
		await expect(sheet).toBeVisible();

		await sheet.getByRole('button', { name: '+1 check-in' }).click();

		// The burst that matters is the dial's own, on the card inside the sheet —
		// the astronaut at the top of the page is behind the modal's backdrop and
		// nobody sees it. The dialog has to still be here to show it at all: a
		// rebuilt or reopened one would have already lost the dial's sweep.
		const burst = sheet.locator('.burst');
		await expect(burst).toBeAttached();
		await expect(sheet).toBeVisible();
		await expect(sheet.getByText('Orbit closed today')).toBeVisible();
		await expect(burst).toHaveCount(0, { timeout: 5_000 });

		// Only once the celebration is over does the goal make the move a plain
		// partition would have made instantly — into the Closed fold, ring and
		// all. That move is still a goal crossing from one `{#each}` to another,
		// which Svelte always treats as a destroy and a create (see #51's own
		// spec), so the row it lands in in Closed is a fresh one; what the hold
		// promised was only that this never happens before the celebration ends.
		await expect(page.getByText('Closed (1)')).toBeVisible();
		await expect(page.locator('.row').filter({ hasText: 'Evening stretch' })).toContainText(
			'Orbit closed today'
		);
	});

	test('non-compact keeps the same GoalCard through the sweep', async ({ page }) => {
		await pinClock(page, EVENING);
		await launchDailyGoal(page, 'Evening pages');
		await page.goto('/today');
		await hydrated(page);

		await page.getByRole('button', { name: '+1 check-in' }).click();

		const burst = page.getByRole('article').locator('.burst');
		await expect(burst).toBeAttached();
		await expect(page.getByRole('article')).toContainText('Orbit closed today');
		await expect(burst).toHaveCount(0, { timeout: 5_000 });

		await expect(page.getByText('Closed (1)')).toBeVisible();
	});
});
