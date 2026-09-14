import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The share target: sharing text into Nova from another app lands here with a
 * `text` parameter, and picking a goal logs an entry with that text as the
 * note — see the manifest's `share_target` in `vite.config.ts`.
 */

async function register(page: Page) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Priya Shah');
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

test('arriving with shared text, picking a goal logs it as the note', async ({ page }) => {
	await register(page);
	await launchGoal(page, 'Read pages', '20');

	const sharedText = 'Finished chapter 3 on the train';
	await page.goto(`/share?text=${encodeURIComponent(sharedText)}`);
	await hydrated(page);

	// The note arrives editable, pre-filled from the shared text.
	await expect(page.getByLabel('Note')).toHaveValue(sharedText);

	await page.getByRole('button', { name: 'Read pages' }).click();
	await expect(page.getByText('Logged.')).toBeVisible();

	// Follow the goal from the dashboard rather than guessing its id. The
	// heading link's accessible name is the bare title; the dial beside it
	// also mentions the goal, so this needs the exact match.
	await page.goto('/');
	await hydrated(page);
	await page.getByRole('link', { name: 'Read pages', exact: true }).click();

	await expect(page.getByText(sharedText)).toBeVisible();
});

test('sharing without an account first signs in, then returns to the shared text', async ({
	page
}) => {
	const sharedText = 'Loved this idea';
	await page.goto(`/share?text=${encodeURIComponent(sharedText)}`);
	await expect(page).toHaveURL(/\/login\?next=/);

	// The redirect target survives the round trip through login.
	const next = new URL(page.url()).searchParams.get('next');
	expect(next).toBe(`/share?text=${encodeURIComponent(sharedText)}`);
});
