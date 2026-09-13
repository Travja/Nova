import { expect, test, type Browser, type Page } from '@playwright/test';
import { hydrated, outboxCount, waitForResetLink } from './helpers';

/**
 * The way back in from a forgotten password: ask, follow the mailed link once,
 * and land signed out everywhere with a password only you know.
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

async function signInElsewhere(browser: Browser, email: string, password: string) {
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

async function askForReset(page: Page, email: string) {
	await page.goto('/forgot');
	await expect(page.getByRole('heading', { name: 'Lost your way back?' })).toBeVisible();
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send the link' }).click();
	await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
}

test('a forgotten password can be reset from the mailed link', async ({ browser, page }) => {
	const email = `forgot-${Date.now()}@example.com`;
	const next = 'brand-new-orbit-77';
	await register(page, email);

	// Another device stays signed in, to prove the reset evicts it.
	const other = await signInElsewhere(browser, email, PASSWORD);

	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.goto('/login');
	await page.getByRole('link', { name: 'Forgotten your password?' }).click();
	// Both pages have an Email field, so wait for this one to be the one on
	// screen before typing into it.
	await expect(page.getByRole('heading', { name: 'Lost your way back?' })).toBeVisible();

	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send the link' }).click();
	await expect(page.getByText(/a reset link is on its way/)).toBeVisible();

	const link = await waitForResetLink(email);
	await page.goto(link);
	await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

	await page.getByLabel('New password', { exact: true }).fill(next);
	await page.getByLabel('New password again').fill(next);
	await page.getByRole('button', { name: 'Set the password' }).click();

	await expect(page.getByText(/Your password is set/)).toBeVisible();

	// The old password is dead, the new one works.
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByText('That email and password combination did not work.')).toBeVisible();

	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(next);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('link', { name: 'New goal' })).toBeVisible();

	// And the device that was signed in the whole time has been evicted.
	await other.page.goto('/');
	await expect(
		other.page.getByRole('navigation').getByRole('link', { name: 'Sign in' })
	).toBeVisible();
	await other.context.close();
});

test('a reset link works exactly once', async ({ page }) => {
	const email = `once-${Date.now()}@example.com`;
	await register(page, email);
	await page.getByRole('button', { name: 'Sign out' }).click();

	await askForReset(page, email);
	const link = await waitForResetLink(email);

	await page.goto(link);
	await page.getByLabel('New password', { exact: true }).fill('first-choice-999');
	await page.getByLabel('New password again').fill('first-choice-999');
	await page.getByRole('button', { name: 'Set the password' }).click();
	await expect(page.getByText(/Your password is set/)).toBeVisible();

	// Second time round the same link is spent, and the form is not offered.
	await page.goto(link);
	await expect(page.getByText('That link has expired or has already been used.')).toBeVisible();
	await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});

test('asking about an address nobody owns says the same thing and mails nothing', async ({
	page
}) => {
	const stranger = `nobody-${Date.now()}@example.com`;

	await askForReset(page, stranger);

	// Identical wording to the registered case above — the page cannot be used
	// to find out who has an account — and no mail was actually sent.
	expect(await outboxCount(stranger)).toBe(0);
});
