import { expect, type Page, test } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * The opt-in, and the terms that come with it.
 *
 * What is testable here is everything up to the subscription itself: a headless
 * browser has no push service to subscribe against, so no notification is ever
 * delivered in this suite and the rules that decide whether one should be are
 * unit-tested in `src/lib/domain/reminders.test.ts` instead. What these cover
 * is the part a person touches — the switch and the quiet window, which work
 * without JavaScript — and that the device half explains itself rather than
 * hanging when it cannot go through.
 */

async function register(page: Page, name: string) {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

test('reminders are off until asked for, and the terms survive a reload', async ({ page }) => {
	await register(page, 'Ada Fernsby');

	await page.goto('/settings');
	await page.getByRole('link', { name: 'Reminders' }).click();
	await expect(page.getByRole('heading', { name: 'Reminders', level: 1 })).toBeVisible();

	// Nothing is on for an account that has never asked.
	const enabled = page.getByRole('switch', { name: 'Send me reminders' });
	await expect(enabled).not.toBeChecked();
	await expect(page.getByLabel('From')).toHaveValue('22:00');
	await expect(page.getByLabel('Until')).toHaveValue('07:00');

	await enabled.check();
	await page.getByLabel('From').fill('21:30');
	await page.getByLabel('Until').fill('06:15');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	// Stored on the account, not in the browser: a reload says the same thing.
	await page.reload();
	await expect(page.getByRole('switch', { name: 'Send me reminders' })).toBeChecked();
	await expect(page.getByLabel('From')).toHaveValue('21:30');
	await expect(page.getByLabel('Until')).toHaveValue('06:15');
});

test('opting out is one tap, and it sticks', async ({ page }) => {
	await register(page, 'Bram Oyelaran');

	await page.goto('/settings/reminders');
	await page.getByRole('switch', { name: 'Send me reminders' }).check();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await page.getByRole('switch', { name: 'Send me reminders' }).uncheck();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await page.reload();
	await expect(page.getByRole('switch', { name: 'Send me reminders' })).not.toBeChecked();
});

test('a quiet window Nova cannot read is refused rather than saved', async ({ page }) => {
	await register(page, 'Cleo Márquez');
	await page.goto('/settings/reminders');

	// `type="time"` refuses most nonsense before it is submitted, so this posts
	// the way a client without that input would — which is also the no-JavaScript
	// path: `accept: text/html` is what makes SvelteKit answer with the
	// re-rendered page and the action's own status, rather than the JSON envelope
	// it hands to `enhance`. The origin is explicit because SvelteKit refuses a
	// cross-site form post, and this one is not one.
	const asABrowserWouldPost = {
		headers: { origin: new URL(page.url()).origin, accept: 'text/html' }
	};
	const response = await page.request.post('/settings/reminders?/save', {
		form: { enabled: 'on', quietFrom: 'evening', quietUntil: '07:00' },
		...asABrowserWouldPost
	});
	expect(response.status()).toBe(400);
	expect(await response.text()).toContain('Give both quiet hours as a time of day.');

	await page.reload();
	await expect(page.getByRole('switch', { name: 'Send me reminders' })).not.toBeChecked();
});

test('this device explains itself instead of hanging', async ({ page, context }) => {
	// Granting notifications is what lets a browser that has push get as far as
	// looking for a service worker. Without the grant it answers "denied" and the
	// page says that instead — every one of these is an answer, which is the
	// point: the section must never be left saying "checking".
	await context.grantPermissions(['notifications']);
	await register(page, 'Dai Rutherford');

	await page.goto('/settings/reminders');
	await hydrated(page);

	const device = page.locator('.panel').filter({ hasText: 'This device' });
	// Nothing is known until mount, so this is what waits for the verdict — and
	// the verdict is the thing under test: this section must never be left
	// saying "checking" at somebody.
	await expect(device).not.toContainText('Checking what this browser supports');

	const turnOn = device.getByRole('button', { name: 'Turn on for this device' });
	if (await turnOn.isVisible()) {
		// A browser that can subscribe: the dev server registers no service
		// worker, so saying so is the honest answer rather than a wait that never
		// ends.
		await turnOn.click();
		await expect(page.getByText(/service worker is not running/)).toBeVisible();
	} else {
		// Every other verdict is a sentence saying why not, and which one depends
		// on the browser rather than on Nova: `chrome-headless-shell` — what CI
		// installs and what Playwright launches by default — reports push support
		// and then denies the permission, so it lands on "blocked" here.
		await expect(device).toContainText(
			/blocked for Nova|cannot receive push notifications|Add to Home Screen/
		);
	}

	// Either way, nothing was stored on the strength of a subscription that never
	// was.
	await expect(page.getByText('No device is set up to receive reminders yet.')).toBeVisible();
});

test('a test send says plainly that nothing took delivery', async ({ page }) => {
	await register(page, 'Esi Nkrumah');
	await page.goto('/settings/reminders');

	// The button only appears once a device is subscribed, which cannot happen
	// here — so the action is exercised directly, the way a stale page would.
	const response = await page.request.post('/settings/reminders?/test', {
		form: {},
		headers: { origin: new URL(page.url()).origin, accept: 'text/html' }
	});
	expect(response.status()).toBe(409);
	expect(await response.text()).toContain('Nothing took delivery');
});
