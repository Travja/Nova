import { expect, type BrowserContext, type Page, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { hydrated } from './helpers';

/**
 * Offline logging, end to end.
 *
 * This project runs against a production build rather than the dev server the
 * rest of the suite uses, because the thing under test is mostly the service
 * worker: dev registers no worker, so there would be no cache for a reload to
 * land on and no Background Sync queue to replay a flush.
 *
 * Offline is emulated by `context.setOffline()` plus a refusal of the flush
 * route — see `goOffline` for why both are needed. Nothing about the app is
 * stubbed: no fake `navigator.onLine`, no intercepted form posts.
 */

const SHORT_MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/**
 * The label the history strip draws under a daily ring — `13 Sep`.
 *
 * Spelled out rather than formatted through `Intl`, which says "Sept" for
 * September in current ICU while `periodShortName` says "Sep". This project
 * pins the browser's zone to UTC, so the date parts are read in UTC too.
 */
function shortLabel(date: Date): string {
	return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
}

/** The production server's own database, so a test can age a row the UI cannot. */
const DB_FILE = 'data/e2e-pwa.db';

async function register(page: Page): Promise<string> {
	const email = `pilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Nadia Okonkwo');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
	return email;
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

/**
 * Wait until the service worker is not just registered but controlling.
 *
 * `registerType: 'prompt'` means no `clientsClaim`, so the page that installed
 * the worker is never controlled by it — and an uncontrolled page's reload goes
 * straight to the network, which offline means straight to a browser error.
 * One reload hands the page over.
 */
async function controlled(page: Page) {
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
	const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
	if (!hasController) {
		await page.reload();
		await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
			.toBe(true);
	}
	await hydrated(page);
}

/**
 * Go offline, properly.
 *
 * `setOffline` cuts the page but not the service worker — Chromium runs the
 * worker on its own network — so on its own it lets Background Sync replay the
 * queue behind a page that is supposed to have no signal at all. Refusing the
 * flush route as well is what makes "offline" mean offline for both of them,
 * and `internetdisconnected` is the same failure a phone in a lift produces.
 */
async function goOffline(context: BrowserContext) {
	await context.route('**/api/entries', (route) => route.abort('internetdisconnected'));
	await context.setOffline(true);
}

async function goOnline(context: BrowserContext) {
	await context.unroute('**/api/entries');
	await context.setOffline(false);
}

/** How many entries the server has actually recorded for a goal. */
function storedEntries(title: string): { amount: number; occurredAt: number }[] {
	const db = new Database(DB_FILE, { readonly: true });
	try {
		return db
			.prepare(
				`select entries.amount as amount, entries.occurred_at as occurredAt
				 from entries join goals on goals.id = entries.goal_id
				 where goals.title = ? order by entries.occurred_at`
			)
			.all(title) as { amount: number; occurredAt: number }[];
	} finally {
		db.close();
	}
}

test('logs while fully offline, survives a reload, and flushes exactly once', async ({
	page,
	context
}) => {
	const title = `Read pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/');
	await controlled(page);

	const card = page.getByRole('article').filter({ hasText: title });
	await expect(card.getByText('20 pages left today')).toBeVisible();

	await goOffline(context);

	await card.getByRole('button', { name: '+5 pages' }).click();

	// The orbit moves without a round trip: `snapshotGoal`'s own maths, run in
	// the browser over the entry the queue is holding.
	await expect(card.getByText('15 pages left today')).toBeVisible();
	await expect(card.getByText('1 entry waiting to sync')).toBeVisible();
	await expect(page.locator('.queue-bar')).toContainText(
		'1 entry logged offline, waiting to sync.'
	);

	/*
	 * Still offline, and the page comes back from the cache with the queue
	 * rebuilt out of IndexedDB rather than out of the page it was typed on.
	 */
	await page.reload();
	await hydrated(page);
	await expect(card.getByText('15 pages left today')).toBeVisible();
	await expect(card.getByText('1 entry waiting to sync')).toBeVisible();
	expect(storedEntries(title)).toHaveLength(0);

	await goOnline(context);

	// The `online` event drains the queue; the bar goes when the server's own
	// numbers arrive, and the reading does not change as it does.
	await expect(card.getByText('1 entry waiting to sync')).toBeHidden();
	await expect(card.getByText('15 pages left today')).toBeVisible();

	await page.reload();
	await hydrated(page);
	await expect(card.getByText('15 pages left today')).toBeVisible();

	// The whole point of the client id: one entry, however many times the queue,
	// the `online` listener and Background Sync each had a go at sending it.
	expect(storedEntries(title)).toEqual([{ amount: 5, occurredAt: expect.any(Number) }]);
});

test('an entry logged offline lands in the orbit it happened in, not the one it flushed in', async ({
	page,
	context
}) => {
	const title = `Backdated pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	/*
	 * Age the goal so yesterday is inside what it will accept. Backdating
	 * reaches to the start of the orbit a goal launched in and no further, and a
	 * goal launched a minute ago has only ever had one orbit — there is no way
	 * to ask for this case through the UI, and it is the case the whole issue
	 * turns on.
	 */
	const db = new Database(DB_FILE);
	db.prepare('update goals set created_at = ? where title = ?').run(
		Date.now() - 7 * 24 * 60 * 60 * 1000,
		title
	);
	db.close();

	// Yesterday at 09:00 UTC, in the `datetime-local` shape the form takes. The
	// project pins the zone to UTC so this means one instant.
	const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const day = (date: Date) => date.toISOString().slice(0, 10);
	const when = `${day(yesterday)}T09:00`;

	// Launching lands on the goal's own page; the reload is what picks up the
	// backdated `created_at`, which decides how far the `When` field may reach.
	await page.reload();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	await controlled(page);

	/*
	 * The history strip reads by date rather than by period key now, and its
	 * rings are decorative with the orbit in a text node beside them (#7). Same
	 * two facts as before — yesterday's ring and today's, and what each says —
	 * asked of the text the strip actually offers.
	 */
	const ring = (date: Date) =>
		page.locator('.history li').filter({
			has: page.locator('.label', { hasText: new RegExp(`^${shortLabel(date)}$`) })
		});
	const history = ring(yesterday);
	const today = ring(new Date());
	await expect(history).toContainText('0% of target logged');

	await goOffline(context);

	await page.getByLabel('Amount').fill('20');
	await page.getByLabel('When').fill(when);
	await page.getByRole('button', { name: 'Log it' }).click();

	await expect(page.getByText('it will sync when you are back online')).toBeVisible();

	// Yesterday's orbit closes; the one in flight is untouched. An entry stamped
	// with the time it flushed would have done the opposite.
	await expect(history).toContainText('orbit closed, 100% of target logged');
	await expect(today).toContainText('0% of target logged');

	await page.reload();
	await hydrated(page);
	await expect(history).toContainText('orbit closed, 100% of target logged');
	await expect(today).toContainText('0% of target logged');

	await goOnline(context);
	await expect(page.locator('.queue-bar')).toBeHidden();

	await page.reload();
	await hydrated(page);

	// The server agrees, which it only can if nothing restamped the entry on the
	// way through the queue, the flush or the insert.
	await expect(history).toContainText('orbit closed, 100% of target logged');
	await expect(today).toContainText('0% of target logged');

	const stored = storedEntries(title);
	expect(stored).toHaveLength(1);
	expect(new Date(stored[0].occurredAt).toISOString()).toBe(`${day(yesterday)}T09:00:00.000Z`);
});

test('announces what the queue is doing, for anyone not looking at it', async ({
	page,
	context
}) => {
	const title = `Announced pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/');
	await controlled(page);

	const live = page.locator('.queue-live');
	const card = page.getByRole('article').filter({ hasText: title });

	await goOffline(context);
	await card.getByRole('button', { name: '+10 pages' }).click();

	// #7 will audit this: a pending entry that is only a tint is a pending entry
	// nobody using a screen reader ever hears about.
	await expect(live).toHaveText(/Saved on this device\. 1 entry waiting to sync\./);

	await goOnline(context);
	await expect(live).toHaveText(/1 entry synced\./);
	await expect(card.getByText('10 pages left today')).toBeVisible();
});

test('the queue is heard twice when it happens twice', async ({ page, context }) => {
	const title = `Twice pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/');
	await controlled(page);

	const card = page.getByRole('article').filter({ hasText: title });

	/**
	 * Every value the live region takes, in order.
	 *
	 * A live region only speaks when its contents change, so "1 entry synced."
	 * twice running is one announcement unless something makes the second a
	 * change — and nothing about the rendered page shows whether it did. The
	 * region's history does: emptied between the two, it was said twice.
	 */
	await page.evaluate(() => {
		const region = document.querySelector('.queue-live');
		const said: string[] = [];
		(window as unknown as { said: string[] }).said = said;
		if (!region) return;
		new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
			characterData: true,
			childList: true,
			subtree: true
		});
	});

	for (const step of ['+5 pages', '+5 pages']) {
		await goOffline(context);
		await card.getByRole('button', { name: step }).click();
		await expect(page.locator('.queue-live')).toHaveText(/1 entry waiting to sync\./);

		await goOnline(context);
		await expect(page.locator('.queue-live')).toHaveText(/1 entry synced\./);
	}

	await expect(card.getByText('10 pages left today')).toBeVisible();

	const said = await page.evaluate(() => (window as unknown as { said: string[] }).said);
	// Two separate announcements of the same sentence, each preceded by the
	// region being cleared — which is what turns a repeat into news.
	const synced = said.filter((line) => /1 entry synced\./.test(line));
	expect(synced.length, `the live region only ever said: ${JSON.stringify(said)}`).toBe(2);
	expect(said.filter((line) => line === '').length).toBeGreaterThanOrEqual(2);
});

test('syncing from the bar leaves focus in the page rather than on the body', async ({
	page,
	context
}) => {
	const title = `Focus pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/');
	await controlled(page);

	const card = page.getByRole('article').filter({ hasText: title });
	await goOffline(context);
	await card.getByRole('button', { name: '+5 pages' }).click();

	const sync = page.getByRole('button', { name: /Sync now|Syncing/ });
	await sync.focus();
	await expect(sync).toBeFocused();

	// The connection coming back flushes the queue on its own, which empties the
	// bar out from under the button — the case no click handler would ever hear
	// about, and the reason the bar watches itself rather than its actions.
	await goOnline(context);
	await expect(page.locator('.queue-bar')).toBeHidden();
	const landed = await page.evaluate(() => document.activeElement?.id ?? '');
	expect(landed, 'focus was dropped when the queue bar went away').toBe('main-content');
});

test('an entry the server refuses is reported rather than silently dropped', async ({
	page,
	context
}) => {
	const title = `Doomed pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/');
	await controlled(page);

	const card = page.getByRole('article').filter({ hasText: title });
	await goOffline(context);
	await card.getByRole('button', { name: '+5 pages' }).click();
	await expect(card.getByText('1 entry waiting to sync')).toBeVisible();

	// The goal goes while the entry is still in the browser's hands — the case a
	// queue has to have an answer for, since the entry can never land now.
	const db = new Database(DB_FILE);
	db.prepare('delete from goals where title = ?').run(title);
	db.close();

	await goOnline(context);

	const bar = page.locator('.queue-bar');
	await expect(bar).toContainText('1 entry could not be synced.');
	await expect(page.locator('.queue-live')).toContainText('could not be synced');

	// And it says so until it is read, rather than clearing itself.
	await bar.getByRole('button', { name: 'Dismiss' }).click();
	await expect(bar).toBeHidden();
});

test('compact density shows the same pending state, and the bar is thumb-sized', async ({
	page,
	context
}) => {
	const title = `Compact pages ${Date.now()}`;
	await register(page);
	await launchGoal(page, title, '20');

	await page.goto('/settings');
	await hydrated(page);
	await page.getByLabel('Density').selectOption('compact');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	/*
	 * The dashboard, reached deliberately rather than by landing on it — a phone
	 * sends a fresh `/` to Today, which draws a compact row only for a goal that
	 * is running out of time (#48). That is a statement about the hour, and this
	 * project runs a production build, whose clock nothing can pin. The dashboard
	 * draws the same row for every goal at every hour, and the row is what is
	 * under test here.
	 */
	await page.goto('/today');
	await hydrated(page);
	await page.getByRole('link', { name: 'All tiers' }).click();
	await expect(page).toHaveURL(/\/$/);
	await controlled(page);

	// Compact draws rows rather than cards, so the sheet is where a row logs.
	const row = page.locator('.row').filter({ hasText: title });
	await goOffline(context);
	await row.click();
	await page.getByRole('button', { name: '+5 pages' }).click();
	await page.keyboard.press('Escape');

	// The row says pending in its own name, not just in a colour: it has no
	// `aria-label`, so this is part of what the link announces itself as.
	await expect(row.locator('.pending')).toBeVisible();
	await expect(row).toContainText('1 entry waiting to sync');

	const sync = page.getByRole('button', { name: 'Sync now' });
	const box = (await sync.boundingBox())!;
	expect(box.height).toBeGreaterThanOrEqual(44);
	expect(box.width).toBeGreaterThanOrEqual(44);

	await goOnline(context);
	await expect(row.locator('.pending')).toBeHidden();
	await expect(row).toContainText('15 pages left today');
});
