import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage runs against the dev server with its own throwaway
 * database, so a test run never touches real data.
 */
/**
 * Escape hatch for sandboxes and images that already ship a Chromium build,
 * so `playwright install` is not required there. CI installs browsers normally.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? 'list' : 'html',
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'on-first-retry',
		...devices['Desktop Chrome'],
		launchOptions: executablePath ? { executablePath } : {}
	},
	webServer: {
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
	}
});
