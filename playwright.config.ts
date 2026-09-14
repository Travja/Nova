import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage runs against the dev server with its own throwaway
 * database, so a test run never touches real data.
 *
 * Offline logging is the exception, and it runs in its own project against a
 * production build on a second port. It has to: the service worker is not
 * registered in dev — `UpdatePrompt.svelte` skips it — and without a worker
 * there is no cache for a reload to land on and no Background Sync to replay a
 * flush. Testing it against dev would be testing something else.
 */
/**
 * Escape hatch for sandboxes and images that already ship a Chromium build,
 * so `playwright install` is not required there. CI installs browsers normally.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

const OFFLINE_SPEC = '**/offline-logging.spec.ts';

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? 'list' : 'html',
	use: {
		trace: 'on-first-retry',
		...devices['Desktop Chrome'],
		launchOptions: executablePath ? { executablePath } : {}
	},
	projects: [
		{
			name: 'app',
			testIgnore: OFFLINE_SPEC,
			use: { baseURL: 'http://localhost:4173' }
		},
		{
			name: 'offline',
			testMatch: OFFLINE_SPEC,
			use: {
				baseURL: 'http://localhost:4174',
				// Fixed, so a `datetime-local` the test types means the same instant
				// whatever the machine running it thinks the zone is.
				timezoneId: 'UTC'
			}
		}
	],
	webServer: [
		{
			command: 'pnpm db:reset:e2e && pnpm db:migrate && pnpm dev --port 4173',
			port: 4173,
			reuseExistingServer: false,
			env: {
				DATABASE_URL: 'file:./data/e2e.db',
				// Mail goes to files the tests read, never to a server, and ORIGIN is
				// what the reset links are built from.
				MAIL_OUTBOX_DIR: './data/e2e-outbox',
				ORIGIN: 'http://localhost:4173'
			},
			stdout: 'pipe'
		},
		{
			// `pnpm e2e` builds before Playwright starts, so this only has to serve
			// what is already in `build/` — building here would race the dev server
			// above for `.svelte-kit`.
			command: 'pnpm db:reset:e2e:pwa && pnpm db:migrate && node build/index.js',
			port: 4174,
			reuseExistingServer: false,
			env: {
				DATABASE_URL: 'file:./data/e2e-pwa.db',
				MAIL_OUTBOX_DIR: './data/e2e-outbox',
				ORIGIN: 'http://localhost:4174',
				PORT: '4174'
			},
			stdout: 'pipe'
		}
	]
});
