import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ deserialize: JSON.parse }));

import { actionUrl } from './passkeys';

describe('actionUrl', () => {
	it('names the action on the current page', () => {
		expect(actionUrl('passkey', new URL('https://nova.test/login'))).toBe('/login?/passkey');
	});

	it('keeps where the sign-in was headed', () => {
		expect(actionUrl('passkey', new URL('https://nova.test/login?next=%2Fgoals%2Fabc'))).toBe(
			'/login?/passkey&next=%2Fgoals%2Fabc'
		);
	});

	it('drops an action left in the query by a post without JavaScript', () => {
		expect(actionUrl('addPasskey', new URL('https://nova.test/settings/security?/password'))).toBe(
			'/settings/security?/addPasskey'
		);
	});
});
