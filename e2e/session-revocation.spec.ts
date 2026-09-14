import { expect, test, type Browser, type Page } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Session visibility: a pilot signed in on several devices can see them all and
 * end the ones they do not want, and changing the password ends them for them.
 */

const PASSWORD = 'orbit-me-1234';

async function register(page: Page, email: string) {
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Test Pilot');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

/** A second browser, signed in as the same pilot — a different device. */
async function signInElsewhere(browser: Browser, email: string, password = PASSWORD) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto('/login');
	await hydrated(page);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('link', { name: 'New goal' })).toBeVisible();
	return { context, page };
}

/** The masthead link that only an anonymous visitor sees. */
function signedOut(page: Page) {
	return page.getByRole('navigation').getByRole('link', { name: 'Sign in' });
}

/**
 * The page's own live region.
 *
 * Named rather than taken as the only `status` on the page: the offline queue
 * keeps a live region of its own in the layout, so every signed-in page has two
 * and this test is about what the security page says.
 */
function announcement(page: Page) {
	return page.locator('main').getByRole('status');
}

function sessionRows(page: Page) {
	return page.getByRole('list', { name: 'Active sessions' }).getByRole('listitem');
}

test('a pilot can see their sessions and sign other devices out', async ({ browser, page }) => {
	const email = `sessions-${Date.now()}@example.com`;
	await register(page, email);

	const second = await signInElsewhere(browser, email);
	const third = await signInElsewhere(browser, email);

	await page.goto('/settings/security');
	await expect(sessionRows(page)).toHaveCount(3);
	// Exactly, because the current row's sign-out now carries "this device" in
	// its own name — a page of buttons all called "Sign out" is a page of
	// buttons nobody can tell apart. The badge is still what this asserts.
	await expect(page.getByText('This device', { exact: true })).toBeVisible();

	// Ending one device leaves the other two alone.
	await sessionRows(page)
		.filter({ hasNotText: 'This device' })
		.first()
		.getByRole('button', { name: /Sign out/ })
		.click();
	await expect(announcement(page)).toHaveText('One session has been signed out.');
	await expect(sessionRows(page)).toHaveCount(2);

	// And the rest go together.
	await page.getByRole('button', { name: 'Sign out all other sessions (1)' }).click();
	await expect(announcement(page)).toHaveText('One session has been signed out.');
	await expect(sessionRows(page)).toHaveCount(1);
	await expect(page.getByText('This device', { exact: true })).toBeVisible();

	// Both other browsers are now anonymous; this one is still flying.
	for (const other of [second, third]) {
		await other.page.goto('/');
		await expect(signedOut(other.page)).toBeVisible();
		await other.context.close();
	}

	await page.goto('/');
	await expect(page.getByRole('link', { name: 'New goal' })).toBeVisible();
});

test('changing the password signs every other device out', async ({ browser, page }) => {
	const email = `password-${Date.now()}@example.com`;
	const next = 'new-orbit-9876';
	await register(page, email);

	const other = await signInElsewhere(browser, email);

	await page.goto('/settings/security');
	await hydrated(page);

	// The wrong current password changes nothing.
	await page.getByLabel('Current password').fill('not-my-password');
	await page.getByLabel('New password', { exact: true }).fill(next);
	await page.getByLabel('New password again').fill(next);
	await page.getByRole('button', { name: 'Change password' }).click();
	await expect(page.getByText('That is not your current password.')).toBeVisible();
	await expect(sessionRows(page)).toHaveCount(2);

	await page.getByLabel('Current password').fill(PASSWORD);
	await page.getByLabel('New password', { exact: true }).fill(next);
	await page.getByLabel('New password again').fill(next);
	await page.getByRole('button', { name: 'Change password' }).click();

	await expect(announcement(page)).toHaveText('Password changed. 1 other session was signed out.');
	await expect(sessionRows(page)).toHaveCount(1);

	await other.page.goto('/');
	await expect(signedOut(other.page)).toBeVisible();
	await other.context.close();

	// The new password is the one that works now.
	const again = await signInElsewhere(browser, email, next);
	await expect(again.page.getByRole('link', { name: 'New goal' })).toBeVisible();
	await again.context.close();
});

test('repeated wrong passwords are throttled', async ({ page }) => {
	const email = `throttled-${Date.now()}@example.com`;
	await register(page, email);

	// Sign out, then work through the free attempts with the wrong password.
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(signedOut(page)).toBeVisible();

	for (let attempt = 0; attempt < 5; attempt += 1) {
		await page.goto('/login');
		await page.getByLabel('Email').fill(email);
		await page.getByLabel('Password').fill('wrong-password');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByText('That email and password combination did not work.')).toBeVisible();
	}

	// The fifth earned a wait, so the sixth is turned away — and so is the right
	// password, which is the point: the throttle is on the account, not the guess.
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('wrong-password');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByText(/Too many sign-in attempts/)).toBeVisible();

	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByText(/Too many sign-in attempts/)).toBeVisible();
});
