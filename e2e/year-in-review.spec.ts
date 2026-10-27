import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hydrated, pinClock } from './helpers';

/**
 * The year in review (#68): a year of data, read back at the turn of it.
 *
 * Nothing in the UI can write a year of history in a test's lifetime — logging
 * is stamped by the real clock, and backdating stops at a goal's launch — so the
 * year is seeded straight into the database, the way `orbit-notes.spec.ts`
 * ages a row. The clock is then pinned to a date, which is the read-only shape
 * `$lib/server/clock` offers, so the dashboard and the review both believe it
 * is 28 December 2026.
 *
 * The numbers are small enough to check by hand, in UTC:
 *
 * - **Morning pages**, a Satellite from 1 December 2025. Closed 1–5 December
 *   2025, every day of April 2026 and 1–10 July 2026. 2026 had 1 January to
 *   27 December decided — 361 days — and 28 December is still in flight.
 * - **Long run**, a Planet from Monday 5 January 2026, closed for the first
 *   twenty weeks. The weeks of 5 January to 21 December are 51; the week of
 *   28 December ends in 2027 and belongs to that year.
 * - **Read 24 books**, a Universe goal, closed already.
 *
 * So 2026 is 40 + 20 + 1 = 61 orbits closed of 361 + 51 + 1 = 413.
 */

const DB_FILE = 'data/e2e.db';
const DAY = 86_400_000;

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

function utc(iso: string): number {
	return new Date(`${iso}T00:00:00Z`).getTime();
}

/** A year of flying for this account, written the way the services would have. */
function seedYear(email: string) {
	const db = new Database(DB_FILE);
	try {
		const { id: userId } = db.prepare('select id from users where email = ?').get(email) as {
			id: string;
		};
		db.prepare('update users set time_zone = ?, week_starts_on = 1 where id = ?').run(
			'UTC',
			userId
		);

		const insertGoal = db.prepare(
			`insert into goals (id, user_id, title, tier, metric_kind, metric_unit, target, color, sort_order, created_at)
			 values (?, ?, ?, ?, 'checkin', '', ?, '#a78bfa', 0, ?)`
		);
		const insertEntry = db.prepare(
			`insert into entries (id, goal_id, amount, occurred_at, created_at) values (?, ?, ?, ?, ?)`
		);
		const log = (goalId: string, at: number, amount = 1) =>
			insertEntry.run(randomUUID(), goalId, amount, at, at);

		const pages = randomUUID();
		insertGoal.run(pages, userId, 'Morning pages', 'satellite', 1, utc('2025-12-01'));
		for (let day = 0; day < 5; day += 1) log(pages, utc('2025-12-01') + day * DAY + 8 * 3_600_000);
		for (let day = 0; day < 30; day += 1) log(pages, utc('2026-04-01') + day * DAY + 8 * 3_600_000);
		for (let day = 0; day < 10; day += 1) log(pages, utc('2026-07-01') + day * DAY + 8 * 3_600_000);

		const run = randomUUID();
		insertGoal.run(run, userId, 'Long run', 'planet', 1, utc('2026-01-05'));
		for (let week = 0; week < 20; week += 1) {
			log(run, utc('2026-01-07') + week * 7 * DAY + 18 * 3_600_000);
		}

		const books = randomUUID();
		insertGoal.run(books, userId, 'Read 24 books', 'universe', 24, utc('2026-01-01'));
		log(books, utc('2026-11-30'), 24);

		const insertNote = db.prepare(
			`insert into orbit_notes (id, goal_id, period_key, period_start, body, created_at, updated_at)
			 values (?, ?, ?, ?, ?, ?, ?)`
		);
		// Written out of order, read back in the order the periods ran.
		const now = Date.now();
		insertNote.run(
			randomUUID(),
			pages,
			'day:2026-04-30',
			utc('2026-04-30'),
			'Thirty mornings straight.',
			now,
			now
		);
		insertNote.run(
			randomUUID(),
			run,
			'week:2026-W15',
			utc('2026-04-06'),
			'Legs finally stopped arguing.',
			now,
			now
		);

		db.prepare(
			`insert into asteroids (id, user_id, title, created_at, drift_anchor_at, resolution, resolved_at)
			 values (?, ?, 'Renew passport', ?, ?, 'cleared', ?)`
		).run(randomUUID(), userId, utc('2026-05-20'), utc('2026-05-20'), utc('2026-06-01'));
	} finally {
		db.close();
	}
}

test('a year of orbits reads back at the turn of the year', async ({ page }) => {
	const email = await register(page, 'Vera Rubin');
	seedYear(email);
	await pinClock(page, '2026-12-28T12:00');

	// The dashboard invites the review in season.
	await page.goto('/');
	await hydrated(page);
	const card = page.getByRole('complementary', { name: 'Your 2026 in orbit' });
	await expect(card).toBeVisible();
	await card.getByRole('link', { name: 'Look back on 2026' }).click();
	await expect(page).toHaveURL(/\/review\/2026$/);
	await hydrated(page);

	await expect(page.getByRole('heading', { name: '2026 in orbit', level: 1 })).toBeVisible();
	await expect(page.getByText('61 orbits closed of 413.')).toBeVisible();

	// Longest flight: April, every day of it.
	await expect(page.getByText('30 orbits in a row')).toBeVisible();
	await expect(page.getByText('Satellite, 1 April to 30 April')).toBeVisible();

	// Per goal, and the year's one Universe orbit.
	const goals = page.getByRole('region', { name: 'Goal by goal' });
	await expect(goals.getByText('Satellite · 40 of 361 closed · best flight 30')).toBeVisible();
	await expect(goals.getByText('Planet · 20 of 51 closed · best flight 20')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Universe goals' })).toContainText(
		/Read 24 books\s*Closed/
	);

	// The notes, in the order their periods ran rather than the order written.
	const notes = page.getByRole('region', { name: 'Notes from the year' }).locator('blockquote');
	await expect(notes).toHaveText(['Legs finally stopped arguing.', 'Thirty mornings straight.']);

	await expect(page.getByText('1 asteroid cleared')).toBeVisible();

	// Last year, side by side and nothing more.
	const compare = page.getByRole('table');
	await expect(compare.getByRole('row', { name: /Orbits closed/ })).toHaveText(
		/Orbits closed\s*5\s*61/
	);

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();
	expect(results.violations.map((violation) => violation.id)).toEqual([]);

	// Dismissed, the card stays away for the season.
	await page.goto('/');
	await hydrated(page);
	await card.getByRole('button', { name: 'Dismiss' }).click();
	await expect(card).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
	await expect(card).toHaveCount(0);
});

test('outside the season the review is a link on stats, and an empty year says so', async ({
	page
}) => {
	const email = await register(page, 'Henrietta Leavitt');
	seedYear(email);
	await pinClock(page, '2026-11-15T12:00');

	await page.goto('/');
	await hydrated(page);
	await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible();
	await expect(page.getByRole('complementary', { name: /in orbit/ })).toHaveCount(0);

	await page.goto('/stats');
	const years = page.getByRole('region', { name: 'Year in review' });
	await expect(years.getByRole('link')).toHaveText(['2026', '2025']);
	await years.getByRole('link', { name: '2026' }).click();
	await expect(page).toHaveURL(/\/review\/2026$/);
	await expect(page.getByText(/so far — the year is still in flight/)).toBeVisible();

	await page.goto('/review/2019');
	await expect(page.getByRole('heading', { name: 'Nothing flew in 2019' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'See 2026' })).toBeVisible();
});
