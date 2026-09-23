import { expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydrated } from './helpers';

/**
 * Export, import and delete — #17.
 *
 * The journey that proves it is the whole round trip: build a record, take it
 * out as a file, destroy the account, start a new one and put the record back.
 * Anything short of that tests the halves rather than the thing.
 *
 * Two assertions here are about what is *not* there. The exported file is
 * scanned for the column names that must never travel, so a column added to
 * `users` next year fails this rather than shipping in a plaintext file. And
 * the database is scanned for orphans after the delete, because a cascade that
 * misses a table leaves rows nobody can reach and nobody can remove.
 */

const DB_FILE = 'data/e2e.db';

async function register(page: Page, name: string): Promise<string> {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill(name);
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	return email;
}

/** Launch a goal and hand back its id, read off the URL it lands on. */
async function launchGoal(
	page: Page,
	title: string,
	tier: string,
	options: { feeds?: string } = {}
): Promise<string> {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: new RegExp(tier) }).check();
	await page.getByLabel('Measured in').selectOption('checkin');
	await page.getByLabel(/Target per orbit/).fill('1');
	if (options.feeds) {
		// Each option names its tier as well as its title, so match on the row
		// and select by value — same as `nested-orbits.spec.ts`.
		const option = page.locator('#parentId option', { hasText: options.feeds });
		await page.selectOption('#parentId', (await option.getAttribute('value')) ?? '');
	}
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	const match = /\/goals\/([^/?]+)/.exec(page.url());
	if (!match) throw new Error(`could not read a goal id out of ${page.url()}`);
	return match[1];
}

/**
 * Push a goal's launch back a week, so its backdating floor lands in the
 * previous orbit and the goal can be given a two-week streak through the UI.
 * The same trick `orbit-notes.spec.ts` uses to age a row nothing on screen can.
 */
function backdateGoal(title: string, days: number) {
	// Titles in this file are unique across the whole suite on purpose: the
	// database is shared between specs and this matches on the title alone.
	const db = new Database(DB_FILE);
	try {
		db.prepare('update goals set created_at = ? where title = ?').run(
			Date.now() - days * 24 * 60 * 60 * 1000,
			title
		);
	} finally {
		db.close();
	}
}

interface GoalRow {
	id: string;
	parentId: string | null;
	entries: number;
}

/** One goal of one account, as the server holds it. */
function goalRow(email: string, title: string): GoalRow | undefined {
	const db = new Database(DB_FILE, { readonly: true });
	try {
		return db
			.prepare(
				`select goals.id as id,
				        goals.parent_id as parentId,
				        (select count(*) from entries where entries.goal_id = goals.id) as entries
				 from goals join users on users.id = goals.user_id
				 where users.email = ? and goals.title = ?`
			)
			.get(email, title) as GoalRow | undefined;
	} finally {
		db.close();
	}
}

/** Every row anywhere whose owner is gone. All of these have to be zero. */
function orphanCounts(): Record<string, number> {
	const db = new Database(DB_FILE, { readonly: true });
	try {
		const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
		const byUser = (table: string) =>
			count(`select count(*) as n from ${table} where user_id not in (select id from users)`);
		const byGoal = (table: string) =>
			count(`select count(*) as n from ${table} where goal_id not in (select id from goals)`);

		return {
			sessions: byUser('sessions'),
			passwordResetTokens: byUser('password_reset_tokens'),
			goals: byUser('goals'),
			asteroids: byUser('asteroids'),
			pushSubscriptions: byUser('push_subscriptions'),
			reminderSettings: byUser('reminder_settings'),
			goalArchiveWindows: byGoal('goal_archive_windows'),
			entries: byGoal('entries'),
			orbitNotes: byGoal('orbit_notes')
		};
	} finally {
		db.close();
	}
}

function rowsFor(email: string): number {
	const db = new Database(DB_FILE, { readonly: true });
	try {
		const { n } = db
			.prepare(
				`select (select count(*) from users where email = ?)
				      + (select count(*) from goals join users on users.id = goals.user_id where users.email = ?)
				      + (select count(*) from asteroids join users on users.id = asteroids.user_id where users.email = ?)
				      + (select count(*) from sessions join users on users.id = sessions.user_id where users.email = ?)
				      as n`
			)
			.get(email, email, email, email) as { n: number };
		return n;
	} finally {
		db.close();
	}
}

/** Download the export and hand back both the JSON text and a path to it. */
async function downloadExport(page: Page): Promise<{ text: string; path: string }> {
	await page.goto('/settings/data');
	await hydrated(page);

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Download my data', exact: true }).click()
	]);

	expect(download.suggestedFilename()).toMatch(/^nova-export-\d{4}-\d{2}-\d{2}\.json$/);

	const path = join(tmpdir(), `nova-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
	await download.saveAs(path);
	return { text: await readFile(path, 'utf8'), path };
}

async function importFile(page: Page, path: string, mode: 'merge' | 'replace' = 'merge') {
	await page.goto('/settings/data');
	await hydrated(page);
	await page.getByLabel('Export file').setInputFiles(path);
	if (mode === 'replace') await page.getByRole('radio', { name: 'Replace' }).check();
	await page.getByRole('button', { name: 'Check this file' }).click();
}

test('a record survives export, deletion, a new account and import', async ({ page }) => {
	const pilot = await register(page, 'Orla Vance');

	// A monthly goal fed by a weekly one, so the import has a parent edge to
	// remap as well as rows to move.
	await launchGoal(page, 'Monthly consistency', 'Star System');
	const weeklyId = await launchGoal(page, 'Chapter a week', 'Planet', {
		feeds: 'Monthly consistency'
	});

	// A week back, so the backdating floor is the previous orbit.
	backdateGoal('Chapter a week', 7);

	// Close last week's orbit and this week's, which is a streak of two.
	await page.goto(`/goals/${weeklyId}`);
	await hydrated(page);
	const when = page.getByLabel('When');
	const earliest = (await when.getAttribute('min')) as string;
	await page.getByLabel('Amount', { exact: true }).fill('1');
	await when.fill(earliest);
	await page.getByRole('button', { name: 'Log it' }).click();
	await page.getByRole('button', { name: '+1 check-in' }).click();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Chapter a week' })).toBeVisible();
	await expect(page.getByText('Streak').first().locator('..').getByText('2')).toBeVisible();

	// A one-off on the belt, which travels with everything else.
	await page.goto('/today');
	await hydrated(page);
	await page.getByLabel('Add a one-off').fill('Renew the passport');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('Renew the passport', { exact: true })).toBeVisible();

	// And a note on the orbit that closed last week.
	await page.goto(`/goals/${weeklyId}/history`);
	await hydrated(page);
	await page
		.locator('.orbits li')
		.last()
		.getByRole('link', { name: /Add note/ })
		.click();
	const editor = page.locator('.orbits li.orbits__row--editing');
	await editor.getByRole('textbox').fill('Slow week, but it closed.');
	await editor.getByRole('button', { name: 'Save note' }).click();
	await expect(page.locator('.orbits li').last()).toContainText('Slow week, but it closed.');

	const before = goalRow(pilot, 'Chapter a week');
	expect(before?.entries).toBe(2);

	/* ---------------------------------------------------------------- export */

	const exported = await downloadExport(page);

	// What is in it.
	expect(exported.text).toContain('"schemaVersion": 1');
	expect(exported.text).toContain('Chapter a week');
	expect(exported.text).toContain('Renew the passport');
	expect(exported.text).toContain('Slow week, but it closed.');

	// And what must never be. The real file, scanned: the account that owns
	// these goals is not described anywhere in it, so there is nothing here to
	// leak when it lands in a Downloads folder and gets mailed onwards.
	for (const forbidden of [
		// Credentials and devices, which were never exportable.
		'passwordHash',
		'password_hash',
		'argon2',
		'sessionToken',
		'"sessions"',
		'passwordResetTokens',
		'pushSubscriptions',
		'endpoint',
		'p256dh',
		'lastSentAt',
		'lastSeenAt',
		'expiresAt',
		'userId',
		// The account itself. This file restores goals, not accounts.
		'profile',
		'email',
		'@example.com',
		pilot,
		'Orla Vance',
		'displayName',
		'timeZone',
		'weekStartsOn',
		'preferences',
		'reminderSettings',
		'quietFrom'
	]) {
		expect(exported.text, `the export must not carry ${forbidden}`).not.toContain(forbidden);
	}

	/* ---------------------------------------------------------------- delete */

	await page.goto('/settings/data');
	await hydrated(page);

	// The wrong address does nothing at all.
	await page.getByLabel(/Type/).fill('someone-else@example.com');
	await page.getByRole('button', { name: 'Delete my account' }).click();
	await expect(
		page.getByText('Type the account’s email address exactly to confirm.')
	).toBeVisible();
	expect(rowsFor(pilot)).toBeGreaterThan(0);

	await page.getByLabel(/Type/).fill(pilot);
	await page.getByRole('button', { name: 'Delete my account' }).click();

	// Deleting signs every device out, because the sessions go with the row.
	await expect(page.getByRole('link', { name: 'Start flying' }).first()).toBeVisible();
	expect(rowsFor(pilot)).toBe(0);
	expect(orphanCounts()).toEqual({
		sessions: 0,
		passwordResetTokens: 0,
		goals: 0,
		asteroids: 0,
		pushSubscriptions: 0,
		reminderSettings: 0,
		goalArchiveWindows: 0,
		entries: 0,
		orbitNotes: 0
	});

	/* ---------------------------------------------------------------- import */

	const restored = await register(page, 'Orla Vance');

	await importFile(page, exported.path);
	await expect(page.getByRole('heading', { name: 'What this would do' })).toBeVisible();
	await expect(page.getByText('Goals: Would add 2 of 2.')).toBeVisible();
	await expect(page.getByText('Entries: Would add 2 of 2.')).toBeVisible();
	await expect(page.getByText('Asteroids: Would add 1 of 1.')).toBeVisible();
	await expect(page.getByText('Orbit notes: Would add 1 of 1.')).toBeVisible();

	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByText('Import finished.')).toBeVisible();

	// Everything reads as it did, including the streak the entries add up to.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Chapter a week' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Monthly consistency' })).toBeVisible();
	await expect(page.getByText('Streak').first().locator('..').getByText('2')).toBeVisible();

	await page.goto('/today');
	await expect(page.getByText('Renew the passport', { exact: true })).toBeVisible();

	const child = goalRow(restored, 'Chapter a week');
	const parent = goalRow(restored, 'Monthly consistency');
	expect(child?.entries).toBe(2);
	// Ids were minted fresh, and the edge between them was rewritten to match.
	expect(child?.id).not.toBe(before?.id);
	expect(child?.parentId).toBe(parent?.id);

	const restoredId = child?.id as string;
	await page.goto(`/goals/${restoredId}/history`);
	await expect(page.getByText('Slow week, but it closed.')).toBeVisible();

	/* ------------------------------------------------------- and again, twice */

	await importFile(page, exported.path);
	await expect(page.getByText('Goals: Would add 0 of 2, 2 already here.')).toBeVisible();
	await expect(page.getByText('Entries: Would add 0 of 2, 2 already here.')).toBeVisible();
	await expect(page.getByText('Asteroids: Would add 0 of 1, 1 already here.')).toBeVisible();
	await expect(page.getByText('Orbit notes: Would add 0 of 1, 1 already here.')).toBeVisible();

	await page.getByRole('button', { name: 'Import', exact: true }).click();
	await expect(page.getByText('Import finished.')).toBeVisible();

	// Nothing doubled: the same goal, the same two entries, the same one rock.
	expect(goalRow(restored, 'Chapter a week')).toEqual(child);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Chapter a week' })).toHaveCount(1);
	await expect(page.getByText('Streak').first().locator('..').getByText('2')).toBeVisible();
});

test('a bundle with a bad row writes nothing at all, and says which row', async ({ page }) => {
	const pilot = await register(page, 'Casimir Wren');
	await launchGoal(page, 'Morning mobility', 'Satellite');

	const exported = await downloadExport(page);

	// One field, made impossible. Everything else in the file is still valid,
	// which is the point: a bundle is all-or-nothing.
	const tampered = JSON.parse(exported.text);
	tampered.goals[0].color = 'javascript:alert(1)';
	const path = join(tmpdir(), `nova-e2e-bad-${Date.now()}.json`);
	await writeFile(path, JSON.stringify(tampered), 'utf8');

	await importFile(page, path);
	await expect(page.getByText(/goals\[0\]\.color/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What this would do' })).toHaveCount(0);

	// The account is exactly as it was: one goal, not two.
	expect(goalRow(pilot, 'Morning mobility')).toBeDefined();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Morning mobility' })).toHaveCount(1);
});

test('a file from a newer Nova is refused rather than half-read', async ({ page }) => {
	await register(page, 'Tam Okonjo');
	await launchGoal(page, 'Weekly walk', 'Planet');

	const exported = await downloadExport(page);
	const future = JSON.parse(exported.text);
	future.schemaVersion = 99;
	const path = join(tmpdir(), `nova-e2e-future-${Date.now()}.json`);
	await writeFile(path, JSON.stringify(future), 'utf8');

	await importFile(page, path);
	await expect(page.getByText(/newer Nova/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What this would do' })).toHaveCount(0);
});

test('replace clears what is there before it imports', async ({ page }) => {
	await register(page, 'Nils Thorsen');
	await launchGoal(page, 'Weekly walk', 'Planet');
	const exported = await downloadExport(page);

	// A second account with a record of its own, which replace is about to end.
	// `/register` sends a signed-in pilot home, so sign out first.
	await page.getByRole('button', { name: 'Sign out' }).click();
	const other = await register(page, 'Maja Lindqvist');
	await launchGoal(page, 'Old habit', 'Satellite');

	await importFile(page, exported.path, 'replace');
	await expect(
		page.getByText('Goals: Would add 1 of 1, would delete 1 already in the account.')
	).toBeVisible();

	await page.getByRole('button', { name: 'Replace my data' }).click();
	await expect(page.getByText('Import finished.')).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Weekly walk' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Old habit' })).toHaveCount(0);
	expect(goalRow(other, 'Old habit')).toBeUndefined();
});
