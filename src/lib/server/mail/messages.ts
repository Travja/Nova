import type { MailMessage } from './index';

/**
 * The one message Nova sends. Plain text on purpose: it is short, it renders
 * everywhere, and a mail with no images or markup is markedly less likely to
 * be treated as spam by a receiver that has never heard of your domain.
 */
export function passwordResetMessage(input: {
	to: string;
	displayName: string;
	link: string;
	expiresInMinutes: number;
}): MailMessage {
	const text = [
		`Hello ${input.displayName},`,
		'',
		'Someone asked to reset the password on your Nova account. If that was',
		'you, open this link to choose a new one:',
		'',
		input.link,
		'',
		`The link works once and expires in ${input.expiresInMinutes} minutes.`,
		'',
		'If it was not you, you can ignore this. Your password has not changed,',
		'and nobody can use this link without the mail it arrived in.',
		'',
		'— Nova'
	].join('\n');

	return { to: input.to, subject: 'Reset your Nova password', text };
}
