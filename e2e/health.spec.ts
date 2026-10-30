import { expect, test } from '@playwright/test';

/**
 * The endpoint the container healthcheck polls. It has to answer without a
 * session and without rendering a page.
 */
test('the health endpoint reports the database', async ({ request }) => {
	const response = await request.get('/health');

	expect(response.status()).toBe(200);
	expect(await response.json()).toMatchObject({
		status: 'ok',
		database: { ok: true }
	});
	// Every response carries the id its log line is written under.
	expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
	expect(response.headers()['cache-control']).toContain('no-store');
});
