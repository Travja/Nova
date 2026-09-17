import { expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Wait until the layout has hydrated.
 *
 * Forms render server-side and work without JavaScript, so Playwright can type
 * into them before Svelte takes over — at which point bound fields are reset to
 * their initial values and the test fills in a form that then submits something
 * else. Every helper that touches a bound control waits here first.
 */
export async function hydrated(page: Page) {
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

/**
 * Pin the server's clock for everything this browser context loads.
 *
 * The app is correctly time-dependent — a satellite is only running out of time
 * in the last quarter of its day — so a spec that asserts on that has to say
 * which hour it is testing rather than hoping the machine's clock is kind. The
 * cookie is read in development only and the code that reads it is not in a
 * production build; see `$lib/server/clock` for the two shapes it takes and for
 * why a spec that logs entries pins an hour rather than a date.
 *
 * `EVENING` is the hour most specs want: late enough in the user's own day for
 * a satellite to be running out of time, so the Today view is showing its
 * at-risk list rather than a fold of goals that can wait.
 */
export const EVENING = '21:00';

export async function pinClock(page: Page, when: string) {
	await page
		.context()
		.addCookies([{ name: 'nova_clock', value: when, domain: 'localhost', path: '/' }]);
}

/** Where `MAIL_OUTBOX_DIR` puts messages during a test run. */
const OUTBOX = 'data/e2e-outbox';

async function outboxFor(email: string): Promise<string[]> {
	let names: string[];
	try {
		names = await readdir(OUTBOX);
	} catch {
		return [];
	}

	const bodies = await Promise.all(
		names.map((name) => readFile(join(OUTBOX, name), 'utf8').catch(() => ''))
	);
	return bodies.filter((body) => body.includes(`To: ${email}`));
}

/** How many messages this address has been sent so far. */
export async function outboxCount(email: string): Promise<number> {
	return (await outboxFor(email)).length;
}

/**
 * The reset link Nova mailed, once it arrives.
 *
 * The send does not block the response — that is what keeps a known address
 * from answering slower than an unknown one — so the test waits for the file.
 */
export async function waitForResetLink(email: string): Promise<string> {
	let link: string | undefined;

	await expect
		.poll(
			async () => {
				const bodies = await outboxFor(email);
				link = bodies.at(-1)?.match(/http:\/\/\S+\/reset\?token=\S+/)?.[0];
				return link ?? null;
			},
			{ message: `no reset mail arrived for ${email}`, timeout: 5_000 }
		)
		.not.toBeNull();

	return link as string;
}
