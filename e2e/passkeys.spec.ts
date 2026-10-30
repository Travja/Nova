import { expect, test, type Page } from '@playwright/test';
import { hydrated } from './helpers';

/**
 * Passkeys (#69), end to end, against Chromium's virtual authenticator.
 *
 * The authenticator lives in the browser, reached over CDP: a platform
 * authenticator that holds discoverable credentials, verifies its user, and
 * answers every prompt by itself. It belongs to this page, so it survives the
 * sign-out in the middle of the journey exactly as a phone's keychain would.
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

async function virtualAuthenticator(page: Page) {
	/*
	 * This journey signs in with the button. The login page also offers passkeys
	 * from the email field's autofill (conditional mediation), and the virtual
	 * authenticator answers that request by itself — something no real browser
	 * does without the pilot picking a passkey — so left on, the autofill ceremony
	 * races the click: it can sign in and navigate away while Playwright is still
	 * clicking a button that is being torn down. Reporting no autofill support
	 * leaves the button as the only way in, which is the thing being tested.
	 */
	await page.addInitScript(() => {
		if (typeof PublicKeyCredential !== 'undefined') {
			PublicKeyCredential.isConditionalMediationAvailable = async () => false;
		}
	});

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	return {
		async credentials() {
			const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
			return credentials;
		}
	};
}

function passkeyRows(page: Page) {
	return page.getByRole('list', { name: 'Passkeys' }).getByRole('listitem');
}

/** The security page's own live region; the layout keeps another for the offline queue. */
function announcement(page: Page) {
	return page.locator('main').getByRole('status');
}

async function signOut(page: Page) {
	await page.getByRole('navigation').getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Sign in' })).toBeVisible();
}

async function signInWithPasskey(page: Page) {
	await page.goto('/login');
	await hydrated(page);
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
}

test('a pilot adds a passkey, signs in with it, and removes it', async ({ page }) => {
	const authenticator = await virtualAuthenticator(page);
	const email = `passkey-${Date.now()}@example.com`;

	// 1. Register.
	await register(page, email);

	// 2. Add a passkey. The account signed in moments ago, so no password is asked for.
	await page.goto('/settings/security');
	await hydrated(page);
	await expect(page.getByText('No passkeys yet.')).toBeVisible();
	await expect(page.getByLabel('Your password')).toHaveCount(0);
	await page.getByRole('button', { name: 'Add a passkey' }).click();

	await expect(announcement(page)).toContainText('Passkey added');
	await expect(passkeyRows(page)).toHaveCount(1);
	await expect(passkeyRows(page).first()).toContainText('not used yet');
	expect(await authenticator.credentials()).toHaveLength(1);

	// Renamed, and the name sticks.
	const row = passkeyRows(page).first();
	await row.getByRole('textbox').fill('Work laptop');
	await row.getByRole('button', { name: /Rename/ }).click();
	await expect(announcement(page)).toHaveText('Passkey renamed to Work laptop.');
	await page.reload();
	await expect(passkeyRows(page).first()).toContainText('Work laptop');

	// 3. Sign out.
	await signOut(page);

	// 4. Sign in with the passkey — no email, no password.
	await signInWithPasskey(page);
	await expect(page.getByRole('link', { name: 'New goal' })).toBeVisible();

	await page.goto('/settings/security');
	await hydrated(page);
	await expect(passkeyRows(page).first()).toContainText('last used');

	// 5. Remove it. The passkey sign-in just now counts as a recent one.
	await passkeyRows(page)
		.first()
		.getByRole('button', { name: /Remove/ })
		.click();
	await expect(announcement(page)).toHaveText('Passkey removed. It can no longer sign in.');
	await expect(page.getByText('No passkeys yet.')).toBeVisible();

	// 6. The authenticator still holds the credential, and it no longer works.
	expect(await authenticator.credentials()).toHaveLength(1);
	await signOut(page);
	await signInWithPasskey(page);
	await expect(
		page.getByText('That passkey did not work. Try again, or sign in with your password.')
	).toBeVisible();
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole('link', { name: 'New goal' })).toHaveCount(0);

	// The password still does.
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('link', { name: 'New goal' })).toBeVisible();
});
