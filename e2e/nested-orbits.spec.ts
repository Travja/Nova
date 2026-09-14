import { expect, test, type Page } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Nested orbits, end to end: a daily goal feeding a weekly one.
 *
 * A Satellite inside a Planet on purpose. Every other pairing has a period that
 * can straddle its parent's boundary — a week ending in the next month — and
 * which side of the boundary a run lands on would depend on the day the suite
 * happens to run. A day always ends inside its own week, so what this asserts is
 * the mechanic rather than the calendar. The boundary itself is tested where it
 * can be pinned to a real date, in `src/lib/domain/nesting.test.ts`.
 */

async function register(page: Page, name: string) {
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(`nested-${Date.now()}@example.com`);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await hydrated(page);
}

/** Fill the goal form, optionally picking the goal this one feeds. */
async function launch(
	page: Page,
	options: { title: string; tier: RegExp; target: string; feeds?: string }
) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(options.title);
	await page.getByRole('radio', { name: options.tier }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill(options.target);

	if (options.feeds) {
		const option = page.locator('#parentId option', { hasText: options.feeds });
		await page.selectOption('#parentId', (await option.getAttribute('value')) ?? '');
	}

	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: options.title })).toBeVisible();
}

test('a closed child orbit closes one notch of its parent', async ({ page }) => {
	await register(page, 'Nesting Pilot');

	// The parent is launched first: a goal becomes derived when something feeds
	// it, so there is nothing to pick until it exists.
	await launch(page, { title: 'Weekly rhythm', tier: /Planet/, target: '2' });
	const parentUrl = page.url();

	await launch(page, {
		title: 'Daily reading',
		tier: /Satellite/,
		target: '1',
		feeds: 'Weekly rhythm'
	});
	const childUrl = page.url();

	// Nothing has closed yet, so the parent is still at zero — and it is now
	// measured in orbits rather than in the check-ins it was created with.
	await page.goto(parentUrl);
	await expect(page.getByText('2 orbits to go this week.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What feeds this orbit' })).toBeVisible();

	// A goal with children cannot be logged against at all.
	await expect(page.getByRole('heading', { name: 'Log progress' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Log it' })).toHaveCount(0);

	// Close the child's day.
	await page.goto(childUrl);
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();

	await page.goto(parentUrl);
	await expect(page.getByText('1 orbit to go this week.')).toBeVisible();
	await expect(page.getByText('1 orbit / 2 orbits')).toBeVisible();
	await expect(page.getByText('1 orbit closed this week out of 2 orbits')).toBeVisible();

	// Overshooting the child's own target still counts once: the point of
	// counting orbits rather than summing amounts is that cramming buys nothing.
	await page.goto(childUrl);
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await page.getByRole('button', { name: '+1 check-in' }).click();

	await page.goto(parentUrl);
	await expect(page.getByText('1 orbit to go this week.')).toBeVisible();

	// And the dashboard says the same thing, with the child named on the card
	// rather than a row of chips to log against.
	await page.goto('/');
	await expect(page.getByText('1 orbit left this week')).toBeVisible();
	await expect(page.getByText('Fed by Daily reading.')).toBeVisible();
});

test('deleting a parent leaves its children flying', async ({ page }) => {
	await register(page, 'Orphan Pilot');

	await launch(page, { title: 'Monthly push', tier: /Star System/, target: '2' });
	const parentUrl = page.url();
	await launch(page, {
		title: 'Weekly run',
		tier: /Planet/,
		target: '1',
		feeds: 'Monthly push'
	});
	const childUrl = page.url();

	await page.goto(parentUrl);
	// The confirmation is client state, so the page has to have taken over first.
	await hydrated(page);
	await page.getByRole('button', { name: 'Delete goal' }).click();
	await page.getByRole('button', { name: 'Yes, delete it' }).click();

	// The child is orphaned rather than cascaded away, and goes back to being an
	// ordinary goal you can log against.
	await expect(page.getByRole('heading', { name: 'Weekly run' })).toBeVisible();
	await page.goto(childUrl);
	await expect(page.getByRole('heading', { name: 'Log progress' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Monthly push' })).toHaveCount(0);
});

test('the picker only offers goals a cadence can actually feed', async ({ page }) => {
	await register(page, 'Ladder Pilot');

	await launch(page, { title: 'Weekly rhythm', tier: /Planet/, target: '2' });
	await launch(page, { title: 'Daily reading', tier: /Satellite/, target: '1' });

	await page.goto('/goals/new');
	await hydrated(page);

	// A Satellite can feed the Planet; a Planet cannot feed another Planet, and
	// nothing can feed a Satellite.
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await expect(page.locator('#parentId option')).toHaveText([
		'Nothing — this goal stands alone',
		'Weekly rhythm · Planet'
	]);

	await page.getByRole('radio', { name: /Planet/ }).check();
	await expect(page.locator('#parentId option')).toHaveText(['Nothing — this goal stands alone']);
});

test('the rules are enforced by the write path, not only by the picker', async ({ page }) => {
	await register(page, 'Loop Pilot');

	await launch(page, { title: 'Monthly push', tier: /Star System/, target: '2' });
	const parentId = page.url().split('/').pop() ?? '';
	await launch(page, { title: 'Weekly run', tier: /Planet/, target: '1', feeds: 'Monthly push' });
	const childId = page.url().split('/').pop() ?? '';

	/**
	 * Post the edit form straight at the action, as something bypassing the UI
	 * would. SvelteKit answers a `fetch` with the action result rather than a
	 * rendered page, so the refusal is in the body and the HTTP status is 200 —
	 * what matters is that the write did not happen.
	 */
	async function saveParent(goalId: string, tier: string, wanted: string) {
		return page.evaluate(
			async ([id, goalTier, parent]) => {
				const body = new FormData();
				body.set('title', 'Weekly run');
				body.set('tier', goalTier);
				body.set('metricKind', 'checkin');
				body.set('metricUnit', '');
				body.set('target', '1');
				body.set('color', '#a78bfa');
				body.set('parentId', parent);
				const response = await fetch(`/goals/${id}/edit`, { method: 'POST', body });
				return { status: response.status, html: await response.text() };
			},
			[goalId, tier, wanted]
		);
	}

	await page.goto(`/goals/${childId}/edit`);
	await hydrated(page);

	// A goal cannot orbit itself…
	const itself = await saveParent(childId, 'planet', childId);
	expect(itself.html).toContain('"status":400');
	expect(itself.html).toContain('A goal cannot orbit itself.');

	// …nor feed a goal that is not the pilot's, which is how another account's
	// goal is refused without saying whether it exists.
	const sideways = await saveParent(childId, 'planet', parentId.slice(0, -1) + 'x');
	expect(sideways.html).toContain('"status":400');
	expect(sideways.html).toContain('That goal is not one of yours.');

	// The edge that was already there is untouched by either attempt.
	await page.goto(`/goals/${parentId}`);
	await expect(page.getByText('1 goal feeding this one')).toBeVisible();
});
