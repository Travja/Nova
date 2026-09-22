import { expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hydrated } from './helpers';

/**
 * Notes on an orbit's period — #18.
 *
 * The history page is the home for these (never a prompt when an orbit
 * closes), so every journey here goes through `/goals/[id]/history`. A fresh
 * goal only has the one period it launched in, so each test pushes the
 * goal's `createdAt` back through the production database directly — the
 * same trick `offline-logging.spec.ts` uses to age a row the UI cannot.
 */

const DB_FILE = 'data/e2e.db';

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

/** Launches a weekly goal and returns its id, read back off the URL. */
async function launchWeeklyGoal(page: Page, title: string): Promise<string> {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: /Planet/ }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	const match = /\/goals\/([^/]+)/.exec(page.url());
	if (!match) throw new Error(`could not read a goal id out of ${page.url()}`);
	return match[1];
}

/** Push a goal's launch back so its history carries more than the one period it was created in. */
function backdateGoal(title: string, weeksAgo: number) {
	const db = new Database(DB_FILE);
	try {
		db.prepare('update goals set created_at = ? where title = ?').run(
			Date.now() - weeksAgo * 7 * 24 * 60 * 60 * 1000,
			title
		);
	} finally {
		db.close();
	}
}

/** The server's own row for this goal's note, so a test can see past what the UI currently draws. */
function orbitNoteRow(
	title: string
): { periodKey: string; periodStart: number; body: string } | undefined {
	const db = new Database(DB_FILE, { readonly: true });
	try {
		return db
			.prepare(
				`select orbit_notes.period_key as periodKey,
				        orbit_notes.period_start as periodStart,
				        orbit_notes.body as body
				 from orbit_notes join goals on goals.id = orbit_notes.goal_id
				 where goals.title = ?`
			)
			.get(title) as { periodKey: string; periodStart: number; body: string } | undefined;
	} finally {
		db.close();
	}
}

test('a note can be written on a past orbit, read back, edited, and cleared', async ({ page }) => {
	await register(page, 'Nadia Solari');
	const id = await launchWeeklyGoal(page, 'Weekly reading');
	backdateGoal('Weekly reading', 4);

	await page.goto(`/goals/${id}/history`);
	await hydrated(page);

	// Oldest orbit is last in the newest-first list — the backdated week.
	const pastRow = page.locator('.orbits li').last();
	await pastRow.getByRole('link', { name: /Add note/ }).click();

	const editor = page.locator('.orbits li.orbits__row--editing');
	await expect(editor).toHaveCount(1);
	await editor.getByRole('textbox').fill('Knee played up all week, so this one was still a win.');
	await editor.getByRole('button', { name: 'Save note' }).click();

	await expect(page.locator('.orbits li').last()).toContainText(
		'Knee played up all week, so this one was still a win.'
	);
	await expect(
		page.locator('.orbits li').last().getByRole('link', { name: 'Edit note' })
	).toBeVisible();

	// Read back on a fresh visit — not just a client-side echo of the submit.
	// (Not `page.reload()`: the address bar still carries `?note=<key>` from
	// the enhanced submit, same as the entries editor's own `?edit=<id>` on
	// the goal page, so a raw reload would reopen the editor rather than
	// testing whether the note actually persisted.)
	await page.goto(`/goals/${id}`);
	await page.goto(`/goals/${id}/history`);
	await hydrated(page);
	await expect(page.locator('.orbits li').last()).toContainText(
		'Knee played up all week, so this one was still a win.'
	);

	// Edit it in place.
	await page.locator('.orbits li').last().getByRole('link', { name: 'Edit note' }).click();
	const editAgain = page.locator('.orbits li.orbits__row--editing');
	await editAgain
		.getByRole('textbox')
		.fill('Knee recovered by the weekend — closed it out anyway.');
	await editAgain.getByRole('button', { name: 'Save note' }).click();

	await expect(page.locator('.orbits li').last()).toContainText(
		'Knee recovered by the weekend — closed it out anyway.'
	);
	await expect(page.locator('.orbits li').last()).not.toContainText('so this one was still a win');

	// Clear it — the row goes back to offering "Add note" rather than showing an empty one.
	await page.locator('.orbits li').last().getByRole('link', { name: 'Edit note' }).click();
	const editForClear = page.locator('.orbits li.orbits__row--editing');
	await editForClear.getByRole('button', { name: 'Clear note' }).click();

	const clearedRow = page.locator('.orbits li').last();
	await expect(clearedRow.getByRole('link', { name: 'Add note' })).toBeVisible();
	await expect(clearedRow).not.toContainText('closed it out anyway');

	expect(orbitNoteRow('Weekly reading')).toBeUndefined();
});

test('an orbit note survives a change to the pilot’s week start, with its periodStart intact', async ({
	page
}) => {
	await register(page, 'Priya Reyes');
	const id = await launchWeeklyGoal(page, 'Weekly review');
	backdateGoal('Weekly review', 4);

	await page.goto(`/goals/${id}/history`);
	await hydrated(page);

	await page
		.locator('.orbits li')
		.last()
		.getByRole('link', { name: /Add note/ })
		.click();
	const editor = page.locator('.orbits li.orbits__row--editing');
	await editor.getByRole('textbox').fill('Slow week, but the streak held.');
	await editor.getByRole('button', { name: 'Save note' }).click();
	await expect(page.locator('.orbits li').last()).toContainText('Slow week, but the streak held.');

	const before = orbitNoteRow('Weekly review');
	expect(before?.body).toBe('Slow week, but the streak held.');
	// Monday-start weeks key on an ISO week number — see `$domain/period`.
	expect(before?.periodKey.startsWith('week:') && before.periodKey.includes('-W')).toBe(true);

	// Flip the week start from Monday to Sunday. That changes the *shape* of
	// every weekly key, so the row this note is keyed to can no longer match
	// anything `periodFor()` computes — see docs/issues/18-orbit-notes.md.
	await page.goto('/settings');
	await hydrated(page);
	await page.getByLabel('Weeks start on').selectOption('0');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	// The row is never deleted by a preference change, and periodStart —
	// the only durable handle once the key no longer matches — is untouched.
	const after = orbitNoteRow('Weekly review');
	expect(after).toBeDefined();
	expect(after?.periodStart).toBe(before?.periodStart);
	expect(after?.body).toBe('Slow week, but the streak held.');
	expect(after?.periodKey).toBe(before?.periodKey);

	// And it is honest about the consequence: the note no longer shows up
	// against any orbit the history page now draws.
	await page.goto(`/goals/${id}/history`);
	await hydrated(page);
	await expect(page.locator('.orbits')).not.toContainText('Slow week, but the streak held.');
});
