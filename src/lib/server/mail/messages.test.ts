import { describe, expect, it } from 'vitest';
import { passwordResetMessage } from './messages';

describe('passwordResetMessage', () => {
	const message = passwordResetMessage({
		to: 'pilot@example.com',
		displayName: 'Test Pilot',
		link: 'https://nova.example.com/reset?token=abc',
		expiresInMinutes: 30
	});

	it('is addressed to the account and carries the link', () => {
		expect(message.to).toBe('pilot@example.com');
		expect(message.subject).toBe('Reset your Nova password');
		expect(message.text).toContain('Test Pilot');
		expect(message.text).toContain('https://nova.example.com/reset?token=abc');
	});

	it('says how long the link lasts and what to do if it was not you', () => {
		expect(message.text).toContain('expires in 30 minutes');
		expect(message.text).toContain('Your password has not changed');
	});
});
