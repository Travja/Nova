import { expect, type Page } from '@playwright/test';

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
