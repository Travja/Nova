import AxeBuilder from '@axe-core/playwright';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { hydrated, waitForResetLink } from './helpers';

/**
 * The part of #7 that outlives #7.
 *
 * A broken screen-reader experience is invisible from the page — nobody notices
 * it by looking — so the guarantee cannot be "somebody checked once". Every
 * route in the app is scanned here, signed in and signed out, and under each of
 * the four display preferences, which multiply the markup rather than only
 * recolouring it: `compact` swaps goal cards for rows, `contrast: high` swaps
 * the palette, and the two motion settings stop the animation the dial was
 * using to say things.
 *
 * `pnpm e2e` is a CI step, so a new violation fails the build.
 */

/** WCAG 2.1 A and AA, which is the bar #7 set. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * What axe found, as lines a failure message can be read from.
 *
 * The bare `results.violations` prints as a wall of nested objects with the
 * useful part — which rule, on what — buried several levels down.
 */
async function violations(page: Page): Promise<string[]> {
	const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	return results.violations.flatMap((violation) =>
		violation.nodes.map(
			(node) =>
				`${violation.id} (${violation.impact}): ${node.target.join(' ')} — ${violation.help}`
		)
	);
}

/** Visit a route and hold it to the bar. */
async function scan(page: Page, path: string) {
	await page.goto(path);
	await hydrated(page);
	expect(await violations(page), `axe violations on ${path}`).toEqual([]);
}

function freshEmail(): string {
	return `a11y-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string) {
	await page.goto('/register');
	await hydrated(page);
	await page.getByLabel('Name').fill('Rae Alvarez');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await expect(page.getByRole('heading', { name: 'Launch a goal' })).toBeVisible();
}

async function launchGoal(page: Page, title: string, tier: RegExp, target: string) {
	await page.goto('/goals/new');
	await hydrated(page);
	await page.getByLabel('What is the goal?').fill(title);
	await page.getByRole('radio', { name: tier }).check();
	await page.getByLabel('Measured in').selectOption('count');
	await page.getByLabel(/Target per orbit/).fill(target);
	await page.getByLabel('Unit').fill('pages');
	await page.getByRole('button', { name: 'Launch goal' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible();
	return page.url();
}

/**
 * An account with something on every screen.
 *
 * An empty app passes anything — the empty states have no dial, no history
 * strip, no quick-log and no archive row, which is most of what #7 is about. So
 * the sweep runs against a goal part-way round, a goal that has closed, and a
 * goal that is archived.
 */
async function seed(page: Page) {
	await register(page, freshEmail());

	const reading = await launchGoal(page, 'Read pages', /Satellite/, '20');
	await page.getByRole('button', { name: '+5 pages' }).click();
	await expect(page.getByText('15 pages to go today.')).toBeVisible();

	await launchGoal(page, 'Weekly words', /Planet/, '4');
	await page.getByRole('button', { name: '+4 pages' }).click();
	await expect(page.getByText('Orbit closed this week')).toBeVisible();

	const retired = await launchGoal(page, 'Winter swimming', /Star system/i, '8');
	await page.goto(`${retired}?confirm=archive`);
	await hydrated(page);
	// Archiving redirects to the archive, which is where the row has to appear
	// for `/goals/archived` to be scanned against anything at all.
	await page.getByRole('button', { name: 'Archive it' }).click();
	await expect(page.getByRole('heading', { name: 'Archived goals' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Winter swimming' })).toBeVisible();

	return { reading };
}

/** Every signed-in route, with the goal page pointed at a goal that exists. */
function signedInRoutes(goalHref: string): string[] {
	const goalPath = new URL(goalHref).pathname;
	return [
		'/',
		'/?reorder=1',
		'/today',
		'/stats',
		'/goals/new',
		goalPath,
		`${goalPath}?confirm=archive`,
		`${goalPath}/edit`,
		'/goals/archived',
		'/share',
		'/settings',
		'/settings/security',
		'/settings/reminders'
	];
}

test('every signed-out route is clean', async ({ page }) => {
	// A real token rather than the expired state, so the form itself is scanned
	// and not the paragraph that replaces it.
	const email = freshEmail();
	await register(page, email);
	await page.getByRole('button', { name: 'Sign out' }).click();

	await page.goto('/forgot');
	await hydrated(page);
	await page.getByLabel('Email').fill(email);
	await page.getByRole('button', { name: 'Send the link' }).click();
	const link = await waitForResetLink(email);

	for (const path of [
		'/',
		'/login',
		'/register',
		'/forgot',
		new URL(link).pathname + new URL(link).search
	]) {
		await scan(page, path);
	}
});

/**
 * The signed-in sweep, seeded once and then run per preference.
 *
 * Serial with a shared page rather than one test per preference from scratch:
 * seeding an account with a goal part-way round, a goal that has closed and a
 * goal that is archived costs about as long as the scans do, and doing it five
 * times over would be most of this file's runtime. Split into a test each so a
 * failure names the preference that broke rather than the whole matrix.
 */
test.describe.serial('every signed-in route is clean', () => {
	let context: BrowserContext;
	let page: Page;
	let routes: string[];
	/** The screens that actually draw a dial, a history strip and a form. */
	let drawn: string[];

	// An explicit context rather than `browser.newPage()`: axe injects itself
	// into every frame and refuses a page whose context it was not given. The
	// base URL comes from the project, which a hand-made context does not
	// inherit.
	test.beforeAll(async ({ browser }, testInfo) => {
		context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
		page = await context.newPage();
		const { reading } = await seed(page);
		routes = signedInRoutes(reading);
		drawn = ['/', '/today', new URL(reading).pathname, '/goals/new'];
	});

	test.afterAll(async () => {
		await context.close();
	});

	/** Save a preference the way a user would, so the server renders it too. */
	async function choose(preference: string, value: string) {
		await page.goto('/settings');
		await hydrated(page);
		await page.getByLabel(preference).selectOption(value);
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
	}

	test('in the defaults', async () => {
		for (const path of routes) await scan(page, path);
	});

	// `compact` is the preference that changes the markup rather than the paint
	// — a row instead of a card, with a sheet behind it — so it gets the whole
	// sweep. So does the high-contrast palette, which repaints every screen.
	test('under density: compact', async () => {
		await choose('Density', 'compact');
		for (const path of routes) await scan(page, path);
	});

	// The sheet a compact row opens is a screen in its own right and exists only
	// once something has clicked, so the sweep above never reaches it — and it is
	// where compact puts everything the row gave up to be a row.
	test('with a compact row’s sheet open', async () => {
		await choose('Density', 'compact');
		await page.goto('/');
		await hydrated(page);

		// Named, because every row holds a `<dialog>` and a closed one is still a
		// dialog as far as a role query is concerned.
		const sheet = page.getByRole('dialog', { name: /^Read pages/ });

		await page.locator('.row').filter({ hasText: 'Read pages' }).click();
		await expect(sheet).toBeVisible();
		expect(await violations(page), 'axe violations in the compact sheet').toEqual([]);

		// And it closes from the keyboard, which is `<dialog>`'s to provide.
		await page.keyboard.press('Escape');
		await expect(sheet).toBeHidden();
	});

	// Under both of these the body stops travelling and the arc stops sweeping,
	// which is the case #7 asked to confirm: position and fill alone still carry
	// the orbit, and the text equivalent beside the dial carries it regardless.
	test('under motion: reduced', async () => {
		await choose('Motion', 'reduced');
		for (const path of drawn) await scan(page, path);
	});

	test('under motion: none', async () => {
		await choose('Motion', 'none');
		for (const path of drawn) await scan(page, path);
	});

	test('under contrast: high', async () => {
		await choose('Contrast', 'high');
		for (const path of routes) await scan(page, path);
	});
});

/**
 * The dial convention, asserted rather than described.
 *
 * #7 offered two ways to settle the dial and asked for one of them, applied
 * consistently. Nova marks it decorative and guarantees an equivalent text node
 * beside it, which means two things have to be true at every size the dial is
 * drawn at: nothing inside the SVG reaches the accessibility tree, and the
 * orbit is still readable as text. A regression to `role="img"` on one of the
 * four sizes is exactly the drift this catches.
 */
test('the orbit reads as text at every size, and the drawing never does', async ({ page }) => {
	const { reading } = await seed(page);

	for (const path of ['/', '/today', new URL(reading).pathname, '/goals/new']) {
		await page.goto(path);
		await hydrated(page);

		// Hidden by itself or by anything above it — `Rocket` and `Astronaut`
		// carry the attribute on the wrapper they are drawn in.
		const named = await page.evaluate(() =>
			[...document.querySelectorAll('svg')]
				.filter((svg) => !svg.closest('[aria-hidden="true"]'))
				.map((svg) => svg.outerHTML.slice(0, 80))
		);
		expect(named, `an orbit visual on ${path} is exposing itself to the reading`).toEqual([]);
	}

	// The text equivalent, at 120px on a card…
	await page.goto('/');
	await hydrated(page);
	await expect(
		page.getByRole('link', { name: /Read pages, Satellite: 25% of target logged/ })
	).toBeVisible();

	// …and at 200px on the goal page, where the caption carries the amounts and
	// the hidden half carries the reading the arc was making of them.
	await page.goto(new URL(reading).pathname);
	await hydrated(page);
	await expect(page.getByText('25% of target logged', { exact: true })).toBeAttached();

	// The history strip reads as dates rather than as the raw period keys it used
	// to announce — `day:2026-09-14`, forty rings in a row.
	const labels = await page.locator('.history .label').allInnerTexts();
	expect(labels.length).toBeGreaterThan(0);
	for (const label of labels) expect(label).not.toContain(':');

	const spoken = await page.locator('.history li .visually-hidden').first().innerText();
	expect(spoken).toMatch(/^[A-Z][a-z]+ \d+ [A-Z][a-z]+ \d{4}: /);
});
