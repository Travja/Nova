/**
 * Screenshots of the universe view (#11) from the real app, at 390px.
 *
 * Not part of any test run. It seeds three accounts through the app's own form
 * actions — the prototype's 5-, 12- and 40-goal accounts — and photographs
 * each from the zoom stops, plus a tapped body, a tapped rock, a closing and
 * the still frame reduced motion gets.
 *
 * Run it against a development server with a throwaway database, because it
 * moves each rock's drift anchor back in the database directly: an asteroid's
 * drift is measured from when it was written, and nothing in the app can
 * write one three weeks ago.
 *
 *   node scripts/reset-e2e-db.mjs data/shots.db
 *   DATABASE_URL=file:./data/shots.db pnpm db:migrate
 *   DATABASE_URL=file:./data/shots.db ORIGIN=http://localhost:4180 pnpm dev --port 4180
 *   node scripts/universe-screenshots.mjs
 *
 * `BASE_URL`, `DB_FILE` and `OUT_DIR` override the defaults below. Headless
 * Chromium draws WebGL on SwiftShader, hence the launch arguments.
 */
import { chromium } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4180';
const DB_FILE = process.env.DB_FILE ?? 'data/shots.db';
const OUT = process.env.OUT_DIR ?? 'docs/screenshots/11-system-view';
const DAY_MS = 24 * 60 * 60 * 1000;
const TARGET = 20;

/** The prototype's seeded generator, so the 40-goal account is the prototype's account. */
function seeded(seed) {
	let state = seed % 2_147_483_648;
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
		return state / 2_147_483_648;
	};
}

const TIERS = ['satellite', 'planet', 'starSystem', 'galaxy', 'universe'];
const LABEL = {
	satellite: 'Satellite',
	planet: 'Planet',
	starSystem: 'Star System',
	galaxy: 'Galaxy',
	universe: 'Universe'
};
const PALETTE = ['#7dd3fc', '#a78bfa', '#fbbf24', '#f472b6', '#34d399', '#fb7185', '#e2e8f0'];

const goal = (id, title, tier, fraction, color, parentId = null) => ({
	id,
	title,
	tier,
	fraction,
	color,
	parentId
});

const SCENARIOS = {
	5: {
		goals: [
			goal('g1', 'Floss', 'satellite', 1, '#7dd3fc'),
			goal('g2', 'Walk 8k steps', 'satellite', 0.4, '#34d399'),
			goal('g3', 'Run three times', 'planet', 0.65, '#fb7185'),
			goal('g4', 'Read two books', 'starSystem', 0.5, '#fbbf24'),
			goal('g5', 'Save for the trip', 'universe', 0.3, '#34d399')
		],
		asteroids: [0.05, 0.5, 1]
	},
	12: {
		goals: [
			goal('s1', 'Floss', 'satellite', 1, '#7dd3fc'),
			goal('s2', 'Journal', 'satellite', 0.5, '#e2e8f0'),
			goal('s3', 'Duolingo', 'satellite', 0.5, '#34d399'),
			goal('m1', 'A good fitness month', 'starSystem', 0, '#fb7185'),
			goal('p1', 'Mobility five days', 'planet', 0, '#f472b6', 'm1'),
			goal('p2', 'Run three times', 'planet', 0.65, '#fb7185', 'm1'),
			goal('s4', 'Stretch', 'satellite', 0.2, '#f472b6', 'p1'),
			goal('s5', 'Meditate', 'satellite', 1, '#a78bfa', 'p1'),
			goal('p3', 'Call family', 'planet', 0.1, '#fbbf24'),
			goal('m2', 'Read two books', 'starSystem', 0.25, '#fbbf24'),
			goal('q1', 'Ship the side project', 'galaxy', 0.7, '#a78bfa'),
			goal('y1', 'Save for the trip', 'universe', 0.6, '#34d399')
		],
		asteroids: [0.02, 0.1, 0.35, 0.7, 1]
	},
	40: (() => {
		const random = seeded(40);
		const goals = [];
		const counts = { satellite: 12, planet: 10, starSystem: 8, galaxy: 5, universe: 5 };
		for (const tier of TIERS) {
			for (let i = 0; i < counts[tier]; i += 1) {
				const roll = random();
				const fraction = roll < 0.2 ? 1 : roll < 0.3 ? 0 : Math.round(random() * 20) / 20;
				goals.push(
					goal(
						`${tier}-${i}`,
						`${LABEL[tier]} goal ${i + 1}`,
						tier,
						fraction,
						PALETTE[Math.floor(random() * PALETTE.length)]
					)
				);
			}
		}
		const link = (child, parent) => (goals.find((g) => g.id === child).parentId = parent);
		link('satellite-0', 'planet-0');
		link('satellite-1', 'planet-0');
		link('satellite-2', 'planet-1');
		link('planet-0', 'starSystem-0');
		link('planet-2', 'starSystem-0');
		link('planet-3', 'starSystem-1');
		link('starSystem-0', 'galaxy-0');
		link('starSystem-2', 'galaxy-0');
		link('galaxy-1', 'universe-0');
		// Parents first, so every child has an id to point at.
		const depth = (g) => (g.parentId ? 1 + depth(goals.find((p) => p.id === g.parentId)) : 0);
		goals.sort((a, b) => depth(a) - depth(b));
		return { goals, asteroids: [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1, 1, 1] };
	})()
};

const ROCK_TITLES = [
	'Renew passport',
	'Fix the bike light',
	'Clean the garage',
	'Return the drill',
	'Book a dentist visit',
	'Back up the laptop',
	'Sort the loft',
	'Frame the print',
	'Cancel old gym',
	'Replace wiper blades',
	'Email the landlord'
];

async function post(page, path, form) {
	const response = await page.request.post(`${BASE}${path}`, {
		form,
		headers: { origin: BASE },
		maxRedirects: 0
	});
	return response;
}

/** Register a pilot, seed their goals and rocks, and return the goal ids by scenario id. */
async function seed(page, count) {
	const scenario = SCENARIOS[count];
	const email = `shots-${count}-${Date.now()}@example.com`;
	await page.goto(`${BASE}/register`);
	await page.locator('html[data-hydrated="true"]').waitFor();
	await page.getByLabel('Name').fill('Sam');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('orbit-me-1234');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.getByRole('heading', { name: 'Launch a goal' }).waitFor();

	const ids = new Map();
	for (const g of scenario.goals) {
		const response = await post(page, '/goals/new', {
			title: g.title,
			tier: g.tier,
			metricKind: 'count',
			metricUnit: '',
			target: String(TARGET),
			color: g.color,
			parentId: g.parentId ? ids.get(g.parentId) : ''
		});
		// Without `Accept: text/html` SvelteKit answers an action with JSON,
		// the redirect included.
		const { location = '' } = await response.json();
		const id = location.split('/').pop();
		if (!id) {
			const body = (await response.text()).slice(0, 400);
			throw new Error(`Could not create ${g.title}: ${response.status()} ${body}`);
		}
		ids.set(g.id, id);
	}
	// Leaves only: a goal with children counts its children's orbits instead.
	const parents = new Set(scenario.goals.map((g) => g.parentId).filter(Boolean));
	for (const g of scenario.goals) {
		if (parents.has(g.id) || g.fraction <= 0) continue;
		await post(page, '/?/log', {
			goalId: ids.get(g.id),
			amount: String(Math.round(g.fraction * TARGET))
		});
	}

	const rocks = [];
	for (const [index, drift] of scenario.asteroids.entries()) {
		await post(page, '/today?/addAsteroid', { title: ROCK_TITLES[index % ROCK_TITLES.length] });
		rocks.push(drift);
	}
	const db = new Database(DB_FILE);
	const user = db.prepare('select id from users where email = ?').get(email);
	const rows = db
		.prepare('select id from asteroids where user_id = ? order by created_at, rowid')
		.all(user.id);
	const now = Date.now();
	rows.forEach((row, index) => {
		const age = rocks[index] * 21 * DAY_MS + (index === 0 ? 0 : 60_000);
		db.prepare('update asteroids set drift_anchor_at = ? where id = ?').run(
			Math.round(now - age),
			row.id
		);
	});
	db.close();

	await post(page, '/?/view', { view: 'universe' });
	return { ids, rocks: rows.map((row) => row.id) };
}

async function openUniverse(page) {
	await page.goto(`${BASE}/`);
	await page.locator('.universe__view[data-state="ready"]').waitFor();
	await settle(page);
}

async function settle(page) {
	await page.waitForFunction(() => window.__novaUniverse?.settled());
	await page.waitForTimeout(250);
}

async function zoomTo(page, label) {
	const zoom = page.getByRole('slider', { name: 'Zoom' });
	const ticks = await page.locator('.zoom__ticks span').allTextContents();
	const index = ticks.findIndex((tick) => tick.toLowerCase() === label.toLowerCase());
	const value = Math.round((index / (ticks.length - 1)) * 100);
	await zoom.evaluate((input, v) => {
		input.value = String(v);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}, value);
	await settle(page);
}

async function tap(page, id) {
	let at = await page.evaluate((target) => window.__novaUniverse.where(target), id);
	if (!at) {
		// Off screen or folded into its host: go there first, as a focused row would.
		await page.evaluate((target) => window.__novaUniverse.flyTo(target), id);
		await settle(page);
		at = await page.evaluate((target) => window.__novaUniverse.where(target), id);
	}
	if (!at) throw new Error(`${id} is not on screen`);
	await page.mouse.click(at.x, at.y);
	await settle(page);
	await page.waitForTimeout(950);
}

/** `bodyVariant`, as the app computes it: FNV-1a of the id, modulo the tier's three bodies. */
function variantOf(id) {
	let value = 2_166_136_261;
	for (let index = 0; index < id.length; index += 1) {
		value ^= id.charCodeAt(index);
		value =
			(value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
	}
	return (value >>> 0) % 3;
}

/** Fly to a goal, as a tap would, and photograph it close up once it is framed. */
async function closeUp(page, id, name) {
	await page.evaluate((target) => window.__novaUniverse.flyTo(target), id);
	await settle(page);
	await page.waitForTimeout(400);
	await shoot(page, name);
}

async function shoot(page, name) {
	// The whole view on screen, with the toggle above it for context.
	await page.evaluate(() => {
		const top = document.querySelector('.universe__view').getBoundingClientRect().top;
		window.scrollBy(0, top - 96);
	});
	await page.waitForTimeout(100);
	await page.screenshot({ path: `${OUT}/${name}.png` });
	console.log(`${name}.png`);
}

/** Playwright's own Chromium, or the one a sandbox preinstalled beside it — as `playwright.config.ts` does. */
function executablePath() {
	if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
	if (existsSync(chromium.executablePath())) return undefined;
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
	const fallback = root && join(root, 'chromium');
	return fallback && existsSync(fallback) ? fallback : undefined;
}

const browser = await chromium.launch({
	executablePath: executablePath(),
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
mkdirSync(OUT, { recursive: true });

async function context(options = {}) {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		...options
	});
	// `/` redirects a fresh narrow landing to `/today`; a pilot who chose the
	// dashboard keeps it for the session, which is what this says.
	await ctx.addInitScript(() => sessionStorage.setItem('nova:tiered-dashboard', '1'));
	return ctx;
}

{
	const ctx = await context();
	const page = await ctx.newPage();
	await seed(page, 5);
	await openUniverse(page);
	await shoot(page, 'app-5');
	await ctx.close();
}

{
	const ctx = await context();
	const page = await ctx.newPage();
	const { ids, rocks } = await seed(page, 12);
	await openUniverse(page);
	await shoot(page, 'app-12');
	// The belt, a rock tapped: a drifted one, well out toward the edge.
	let rock = null;
	for (const id of [rocks[3], rocks[2], ...rocks]) {
		if (await page.evaluate((target) => window.__novaUniverse.where(target), id)) {
			rock = id;
			break;
		}
	}
	await tap(page, rock);
	// A tap opens the belt's own sheet, over the view.
	await page.screenshot({ path: `${OUT}/app-12-belt.png` });
	console.log('app-12-belt.png');
	await page.keyboard.press('Escape');
	await openUniverse(page);
	await zoomTo(page, 'Universe');
	await shoot(page, 'app-12-universe');
	await zoomTo(page, 'Multiverse');
	await shoot(page, 'app-12-multiverse');
	await zoomTo(page, 'Galaxy');
	await tap(page, ids.get('m1'));
	// The tap opens the goal's sheet and flies the camera behind it.
	await page.screenshot({ path: `${OUT}/app-12-sheet.png` });
	console.log('app-12-sheet.png');
	await page.keyboard.press('Escape');
	await settle(page);
	await shoot(page, 'app-12-focus');

	// A closing: log the rest of "Call family" from its sheet, the one place
	// logging happens, then close the sheet before the burst is raised — the
	// universe draws its own version only when the sheet is not over it.
	await openUniverse(page);
	await tap(page, ids.get('p3'));
	const sheet = page.getByRole('dialog');
	await sheet.getByLabel(/^Amount/).fill(String(TARGET));
	await sheet.getByRole('button', { name: 'Log it' }).click();
	await page.waitForTimeout(150);
	await page.keyboard.press('Escape');
	await page.waitForFunction(() =>
		document.querySelector('.universe [role="status"]')?.textContent?.includes('closed its orbit')
	);
	await page.waitForTimeout(180);
	await shoot(page, 'app-12-closing');

	await openUniverse(page);
	await closeUp(page, ids.get('s2'), 'close-12-satellite');
	await closeUp(page, ids.get('m1'), 'close-12-star-system');
	await closeUp(page, ids.get('q1'), 'close-12-galaxy');
	await closeUp(page, ids.get('y1'), 'close-12-universe');
	await ctx.close();
}

{
	const ctx = await context({ reducedMotion: 'reduce' });
	const page = await ctx.newPage();
	await seed(page, 12);
	await openUniverse(page);
	await shoot(page, 'app-12-still');
	await ctx.close();
}

{
	const ctx = await context();
	const page = await ctx.newPage();
	const { ids: ids40 } = await seed(page, 40);
	await openUniverse(page);
	await shoot(page, 'app-40');
	await zoomTo(page, 'Galaxy');
	await shoot(page, 'app-40-galaxy');
	await zoomTo(page, 'Multiverse');
	await shoot(page, 'app-40-multiverse');

	await openUniverse(page);
	// Ids are fresh on every seed, and so is which body each goal flies, so
	// pick the subjects by tier and variant rather than by name.
	const subjects = [
		['satellite', 0, 'close-comsat'],
		['satellite', 2, 'close-probe'],
		['planet', 0, 'close-banded-planet'],
		['planet', 1, 'close-ringed-planet'],
		['planet', 2, 'close-ice-world'],
		['starSystem', 1, 'close-binary'],
		['starSystem', 2, 'close-star-and-world'],
		['galaxy', 0, 'close-galaxy-spiral'],
		['galaxy', 1, 'close-galaxy-barred'],
		['universe', 1, 'close-universe-nebula'],
		['universe', 2, 'close-universe-web']
	];
	for (const [tier, variant, name] of subjects) {
		const goal = SCENARIOS[40].goals.find(
			(g) => g.tier === tier && variantOf(ids40.get(g.id)) === variant
		);
		if (goal) await closeUp(page, ids40.get(goal.id), name);
		else console.log(`no ${tier} flies variant ${variant} in this seed`);
	}
	await ctx.close();
}

await browser.close();
