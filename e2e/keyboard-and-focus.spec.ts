import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The flows that move something out from under the user.
 *
 * axe reads a page as it stands; none of this is visible to it. Reordering a
 * goal disables the arrow that moved it, revoking a session deletes the row the
 * button was in, and a disclosure is only a disclosure if its state is
 * announced. All three are where "completable from the keyboard alone" is won
 * or lost, and all three fail silently — focus lands on `<body>`, and the next
 * Tab starts again from the top of the document.
 */

async function register(page: Page, email: string, password = 'orbit-me-1234') {
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Kit Nakamura');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launchGoal(page: Page, title: string) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Satellite/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

function freshEmail(): string {
	return `keys-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * The page's own live region.
 *
 * `getByRole('status')` is ambiguous by design now: the layout mounts empty
 * ones up front for the update prompt, the offline queue and the install hint,
 * because a region that appears already full is a region that may never be
 * announced. `.live` is the class every page's own region carries.
 */
function liveRegion(page: Page) {
	return page.locator('p.live');
}

/** What the browser is actually focused on, as something a failure can print. */
function activeElement(page: Page) {
	return page.evaluate(() => {
		const node = document.activeElement as HTMLElement | null;
		if (!node) return 'nothing';
		const label = node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 40) ?? '';
		return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${label ? ` "${label}"` : ''}`;
	});
}

test('a goal reorders from the keyboard, says where it landed, and keeps focus', async ({
	page
}) => {
	await register(page, freshEmail());
	for (const title of ['First light', 'Second wind', 'Third rail']) {
		await launchGoal(page, title);
	}

	await page.goto('/?reorder=1');
	await hydrated(page);

	const order = page.locator('ol.order a.title');
	await expect(order).toHaveText(['First light', 'Second wind', 'Third rail']);

	// Reached by tabbing, not by clicking: the arrows are the keyboard route.
	const down = page.getByRole('button', { name: 'Move First light down' });
	await down.focus();
	await expect(down).toBeFocused();
	await page.keyboard.press('Enter');

	/*
	 * The list first, then what was said about it.
	 *
	 * The announcement goes out ahead of the re-render on purpose — see
	 * `GoalOrderList` — so waiting on it is not waiting for the move to land.
	 * The order is the thing that only changes once the server has answered and
	 * the page has taken the answer, which makes it the barrier before pressing
	 * again.
	 */
	await expect(order).toHaveText(['Second wind', 'First light', 'Third rail']);
	// The position, not just that something moved: the server's own reply cannot
	// say where the goal ended up, because it never knew.
	await expect(liveRegion(page)).toContainText(
		'First light moved to position 2 of 3 in Satellite.'
	);

	// And focus is still on the control that did it, so the next press moves the
	// same goal again rather than starting the tab order over.
	await expect(down).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(order).toHaveText(['Second wind', 'Third rail', 'First light']);
	await expect(liveRegion(page)).toContainText('position 3 of 3');

	// At the end of the list "down" disables itself, so focus is handed to the
	// other arrow on the same row rather than dropped on the document.
	await expect(down).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Move First light up' })).toBeFocused();
});

test('the move buttons stay at the touch floor', async ({ page }) => {
	await register(page, freshEmail());
	await launchGoal(page, 'First light');
	await launchGoal(page, 'Second wind');

	await page.goto('/?reorder=1');
	await hydrated(page);

	// 44px, like every other control in the app — these were 36.
	const box = await page.getByRole('button', { name: 'Move First light down' }).boundingBox();
	expect(box?.width).toBeGreaterThanOrEqual(44);
	expect(box?.height).toBeGreaterThanOrEqual(44);
});

test('revoking a session lands focus somewhere deliberate', async ({ page, browser }) => {
	const email = freshEmail();
	await register(page, email);

	// A second browser holding the same account, so there is a row to revoke
	// that is not the one this test is signed in on.
	const other = await browser.newContext();
	const otherPage = await other.newPage();
	await otherPage.goto('/login');
	await hydrated(otherPage);
	await otherPage.getByLabel('Email').fill(email);
	await otherPage.getByLabel('Password').fill('orbit-me-1234');
	await otherPage.getByRole('button', { name: 'Sign in' }).click();
	await expect(otherPage).not.toHaveURL(/login/);
	await other.close();

	await page.goto('/settings/security');
	await hydrated(page);

	// Scoped to the list: the masthead has a "Sign out" of its own, and the
	// current device's row names itself "Sign out this device".
	const revoke = page
		.getByRole('list', { name: 'Active sessions' })
		.getByRole('button', { name: /^Sign out(?! this device)/ })
		.first();
	await revoke.focus();
	await page.keyboard.press('Enter');

	await expect(liveRegion(page)).toContainText('signed out');

	// The row the button was in has gone. Focus must not have gone with it.
	expect(await activeElement(page)).toBe('ul "Active sessions"');
});

/**
 * What the browser's own accessibility tree says about a disclosure.
 *
 * Playwright's role engine follows ARIA-in-HTML, where `<summary>` has no
 * mapping at all, and reports the fold as plain text — which would make a
 * perfectly good disclosure look broken and tempt somebody into bolting
 * `role="button"` onto it, taking the real mapping away. Chromium does expose
 * it, as a `DisclosureTriangle` carrying `expanded`, so the question is put to
 * Chromium directly. CDP, so Chromium-only; Chromium is the only browser this
 * suite runs.
 */
async function disclosure(page: Page, context: BrowserContext, name: string) {
	const cdp = await context.newCDPSession(page);
	await cdp.send('Accessibility.enable');
	const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
		nodes: Array<{
			role?: { value?: string };
			name?: { value?: string };
			properties?: Array<{ name: string; value: { value?: boolean } }>;
		}>;
	};
	await cdp.detach();

	// Trimmed: Chromium leaves the space where the `aria-hidden` star used to be.
	const node = nodes.find(
		(candidate) =>
			candidate.role?.value === 'DisclosureTriangle' && candidate.name?.value?.trim() === name
	);
	if (!node) return null;
	const property = (key: string) =>
		node.properties?.find((entry) => entry.name === key)?.value.value ?? false;
	return { focusable: property('focusable'), expanded: property('expanded') };
}

test("the Today folds are real disclosures, with their state in the browser's tree", async ({
	page,
	context
}) => {
	await register(page, freshEmail());
	await launchGoal(page, 'First light');
	// Closing it puts the goal in the "Closed" fold, which starts open.
	await page.getByRole('button', { name: '+1 check-in' }).click();
	await expect(page.getByText('Orbit closed today')).toBeVisible();

	await page.goto('/today');
	await hydrated(page);

	expect(await disclosure(page, context, 'Closed (1)')).toEqual({
		focusable: true,
		expanded: true
	});

	// Reached and toggled from the keyboard, with the state following.
	const summary = page.locator('summary', { hasText: 'Closed (1)' });
	await summary.focus();
	await expect(summary).toBeFocused();

	await page.keyboard.press('Enter');
	await expect(page.getByRole('link', { name: 'First light' })).toBeHidden();
	expect(await disclosure(page, context, 'Closed (1)')).toEqual({
		focusable: true,
		expanded: false
	});

	await page.keyboard.press('Enter');
	await expect(page.getByRole('link', { name: 'First light' })).toBeVisible();
	expect(await disclosure(page, context, 'Closed (1)')).toEqual({
		focusable: true,
		expanded: true
	});
});

test('the goal form tabs in order, and both hidden radio groups show focus', async ({ page }) => {
	await register(page, freshEmail());
	await page.goto('/goals/new');
	await hydrated(page);

	/** The ring the browser is drawing on whatever is focused right now. */
	async function focusRing() {
		return page.evaluate(() => {
			const node = document.activeElement as HTMLElement | null;
			if (!node) return null;
			// A radio is hidden behind the label that stands in for it, so the ring
			// that matters is the one on the label.
			const target = node.closest('label') ?? node;
			const style = getComputedStyle(target);
			return {
				on: node.getAttribute('name') ?? node.tagName.toLowerCase(),
				width: parseFloat(style.outlineWidth),
				style: style.outlineStyle
			};
		});
	}

	/**
	 * Tabbed rather than focused by script, because `:focus-visible` is the point:
	 * it is what tells a pointer click apart from a keyboard arrival, and only a
	 * real Tab produces the second.
	 */
	await page.getByLabel('What is the goal?').focus();

	// The order the form is laid out in — a radio group is one stop, landing on
	// whichever option is checked.
	const order = ['description', 'tier', 'metricKind', 'target', 'color'];
	const rings: Record<string, Awaited<ReturnType<typeof focusRing>>> = {};

	for (const field of order) {
		await page.keyboard.press('Tab');
		const ring = await focusRing();
		expect(ring?.on, `Tab out of the previous field should reach ${field}`).toBe(field);
		rings[field] = ring;
	}

	// Both groups hide their input and style the label, which is exactly how a
	// focus ring ends up drawn on a 1px transparent element nobody can see.
	for (const group of ['tier', 'color']) {
		expect(rings[group]?.style, `the ${group} picker draws no focus ring`).not.toBe('none');
		expect(
			rings[group]?.width ?? 0,
			`the ${group} picker's focus ring has no width`
		).toBeGreaterThan(0);
	}
});
