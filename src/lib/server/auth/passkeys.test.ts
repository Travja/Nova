import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => import('$lib/server/testing/memory-db'));

import { db } from '$lib/server/db';
import { passkeys, sessions, users, webauthnChallenges } from '$lib/server/db/schema';
import { SoftwareAuthenticator } from '$lib/server/testing/authenticator';
import { createSession, revokeOtherSessions } from '$lib/server/auth/session';
import { completePasswordReset, createPasswordReset } from '$lib/server/auth/reset';
import { hashToken } from '$lib/server/auth/token';
import { changePassword, deleteAccount, registerUser } from '$lib/server/users';
import { exportBundle, serializeBundle } from '$lib/server/transfer/export';
import {
	beginAuthentication,
	beginRegistration,
	CHALLENGE_LIFETIME_MS,
	confirmIdentity,
	finishAuthentication,
	finishRegistration,
	isRecentSignIn,
	listPasskeys,
	RECENT_SIGN_IN_MS,
	relyingParty,
	removePasskey,
	renamePasskey
} from './passkeys';
import { eq } from 'drizzle-orm';

const ORIGIN = 'https://nova.example.com';
const RP_ID = 'nova.example.com';
const PASSWORD = 'orbit-me-1234';
const IPHONE =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

let previousOrigin: string | undefined;

beforeAll(() => {
	previousOrigin = process.env.ORIGIN;
	process.env.ORIGIN = ORIGIN;
});

afterAll(() => {
	if (previousOrigin === undefined) delete process.env.ORIGIN;
	else process.env.ORIGIN = previousOrigin;
});

beforeEach(async () => {
	await db.delete(users);
});

let counter = 0;

async function pilot() {
	counter += 1;
	const result = await registerUser({
		email: `pilot-${counter}@example.com`,
		password: PASSWORD,
		displayName: 'Test Pilot',
		timeZone: 'UTC',
		weekStartsOn: 1
	});
	if (!result.ok) throw new Error('could not register');
	const { token } = await createSession(result.user.id, IPHONE);
	return { user: result.user, token };
}

/** Make a session look as if it signed in this long ago. */
async function age(token: string, ms: number) {
	await db
		.update(sessions)
		.set({ createdAt: new Date(Date.now() - ms) })
		.where(eq(sessions.id, hashToken(token)));
}

/** A pilot with one passkey on a software authenticator. */
async function pilotWithPasskey() {
	const { user, token } = await pilot();
	const authenticator = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
	const begun = await beginRegistration(user, token, null);
	if (!begun.ok) throw new Error(`could not begin: ${begun.reason}`);
	const finished = await finishRegistration(
		user.id,
		token,
		begun.ceremony,
		authenticator.register(begun.options),
		IPHONE
	);
	if (!finished.ok) throw new Error('could not register a passkey');
	return { user, token, authenticator };
}

async function passkeyCount(userId: string) {
	return (await db.select().from(passkeys).where(eq(passkeys.userId, userId))).length;
}

async function signIn(
	authenticator: SoftwareAuthenticator,
	overrides: { origin?: string; rpId?: string } = {}
) {
	const begun = await beginAuthentication();
	if (!begun) throw new Error('passkeys unavailable');
	return finishAuthentication(
		begun.ceremony,
		authenticator.assert(begun.options.challenge, overrides)
	);
}

describe('the relying party', () => {
	it('is the hostname of ORIGIN, and the origin is ORIGIN itself', () => {
		expect(relyingParty({ ORIGIN: 'https://nova.example.com/' })).toEqual({
			id: 'nova.example.com',
			origin: 'https://nova.example.com'
		});
		expect(relyingParty({ ORIGIN: 'http://localhost:4173' })).toEqual({
			id: 'localhost',
			origin: 'http://localhost:4173'
		});
	});

	it('does not exist in production without ORIGIN', () => {
		expect(relyingParty({ NODE_ENV: 'production' })).toBeNull();
	});
});

describe('a recent sign-in', () => {
	const now = Date.parse('2026-10-27T12:00:00Z');

	it('lasts ten minutes', () => {
		expect(RECENT_SIGN_IN_MS).toBe(10 * 60_000);
		expect(isRecentSignIn(new Date(now - RECENT_SIGN_IN_MS), now)).toBe(true);
		expect(isRecentSignIn(new Date(now - RECENT_SIGN_IN_MS - 1), now)).toBe(false);
		expect(isRecentSignIn(null, now)).toBe(false);
	});

	it('is what a fresh session has, and an old one does not', async () => {
		const { user, token } = await pilot();
		expect(await confirmIdentity(user.id, token, null)).toBe(true);
		await age(token, RECENT_SIGN_IN_MS + 1_000);
		expect(await confirmIdentity(user.id, token, null)).toBe(false);
		expect(await confirmIdentity(user.id, token, 'not-the-password')).toBe(false);
		expect(await confirmIdentity(user.id, token, PASSWORD)).toBe(true);
	});

	it("never counts somebody else's session", async () => {
		const a = await pilot();
		const b = await pilot();
		expect(await confirmIdentity(a.user.id, b.token, null)).toBe(false);
	});
});

describe('adding a passkey', () => {
	it('stores it, named after the device it was added from', async () => {
		const { user } = await pilotWithPasskey();
		const [passkey] = await listPasskeys(user.id);
		expect(passkey.name).toBe('Safari on iPhone');
		expect(passkey.createdOn).toBe('Safari on iPhone');
		expect(passkey.lastUsedAt).toBeNull();
	});

	it('needs the password again from a session that signed in a while ago', async () => {
		const { user, token } = await pilot();
		await age(token, RECENT_SIGN_IN_MS + 1_000);

		expect(await beginRegistration(user, token, null)).toEqual({
			ok: false,
			reason: 'reauthenticate'
		});
		expect(await beginRegistration(user, token, 'wrong-password')).toEqual({
			ok: false,
			reason: 'reauthenticate'
		});
		expect((await beginRegistration(user, token, PASSWORD)).ok).toBe(true);
	});

	it('cannot be finished from another session, even the same account', async () => {
		const { user, token } = await pilot();
		const { token: other } = await createSession(user.id, IPHONE);
		const authenticator = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });

		const begun = await beginRegistration(user, token, null);
		if (!begun.ok) throw new Error('could not begin');
		const response = authenticator.register(begun.options);

		expect(await finishRegistration(user.id, other, begun.ceremony, response, IPHONE)).toEqual({
			ok: false
		});
		expect(await passkeyCount(user.id)).toBe(0);
	});

	it('accepts each challenge once', async () => {
		const { user, token } = await pilot();
		const authenticator = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
		const begun = await beginRegistration(user, token, null);
		if (!begun.ok) throw new Error('could not begin');

		const first = authenticator.register(begun.options);
		expect((await finishRegistration(user.id, token, begun.ceremony, first, IPHONE)).ok).toBe(true);

		const again = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
		const replay = again.register(begun.options);
		expect(await finishRegistration(user.id, token, begun.ceremony, replay, IPHONE)).toEqual({
			ok: false
		});
		expect(await passkeyCount(user.id)).toBe(1);
	});

	it('refuses a response made for another origin', async () => {
		const { user, token } = await pilot();
		const authenticator = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
		const begun = await beginRegistration(user, token, null);
		if (!begun.ok) throw new Error('could not begin');
		const response = authenticator.register(begun.options, { origin: 'https://evil.example' });
		expect(await finishRegistration(user.id, token, begun.ceremony, response, IPHONE)).toEqual({
			ok: false
		});
	});

	it('never takes over a credential another account registered', async () => {
		const owner = await pilotWithPasskey();
		const thief = await pilot();
		const begun = await beginRegistration(thief.user, thief.token, null);
		if (!begun.ok) throw new Error('could not begin');
		const response = owner.authenticator.register(begun.options);

		expect(
			await finishRegistration(thief.user.id, thief.token, begun.ceremony, response, IPHONE)
		).toEqual({ ok: false });
		const [row] = await db.select().from(passkeys).where(eq(passkeys.id, owner.authenticator.id));
		expect(row.userId).toBe(owner.user.id);
	});

	it('turns away something that is not a response at all', async () => {
		const { user, token } = await pilot();
		const begun = await beginRegistration(user, token, null);
		if (!begun.ok) throw new Error('could not begin');
		expect(await finishRegistration(user.id, token, begun.ceremony, 'nope', IPHONE)).toEqual({
			ok: false
		});
	});
});

describe('signing in with a passkey', () => {
	it('names the account it belongs to and stamps it used', async () => {
		const { user, authenticator } = await pilotWithPasskey();
		authenticator.counter = 1;
		expect(await signIn(authenticator)).toEqual({
			ok: true,
			user: { id: user.id, email: user.email }
		});
		const [passkey] = await listPasskeys(user.id);
		expect(passkey.lastUsedAt).not.toBeNull();
	});

	it('works again and again for an authenticator that keeps no counter', async () => {
		const { authenticator } = await pilotWithPasskey();
		authenticator.counter = 0;
		expect((await signIn(authenticator)).ok).toBe(true);
		expect((await signIn(authenticator)).ok).toBe(true);
	});

	/**
	 * Each of these must be indistinguishable from the others. The route shows
	 * one message for `{ ok: false }`, so the service must not leak a reason.
	 */
	describe('fails the same way for', () => {
		const FAILED = { ok: false };

		it('an unknown credential', async () => {
			await pilotWithPasskey();
			const stranger = new SoftwareAuthenticator({ rpId: RP_ID, origin: ORIGIN });
			expect(await signIn(stranger)).toEqual(FAILED);
		});

		it('a wrong origin', async () => {
			const { authenticator } = await pilotWithPasskey();
			expect(await signIn(authenticator, { origin: 'https://nova.example.com.evil.test' })).toEqual(
				FAILED
			);
		});

		it('a wrong relying party', async () => {
			const { authenticator } = await pilotWithPasskey();
			expect(await signIn(authenticator, { rpId: 'evil.test' })).toEqual(FAILED);
		});

		it('a replayed challenge', async () => {
			const { authenticator } = await pilotWithPasskey();
			const begun = await beginAuthentication();
			if (!begun) throw new Error('unavailable');

			authenticator.counter = 1;
			const response = authenticator.assert(begun.options.challenge);
			expect((await finishAuthentication(begun.ceremony, response)).ok).toBe(true);
			expect(await finishAuthentication(begun.ceremony, response)).toEqual(FAILED);

			// A fresh, correctly signed answer to the spent challenge fails too.
			authenticator.counter = 2;
			const later = authenticator.assert(begun.options.challenge);
			expect(await finishAuthentication(begun.ceremony, later)).toEqual(FAILED);
		});

		it('a challenge that failed once', async () => {
			const { authenticator } = await pilotWithPasskey();
			const begun = await beginAuthentication();
			if (!begun) throw new Error('unavailable');
			const wrong = authenticator.assert(begun.options.challenge, { origin: 'https://evil.test' });
			expect(await finishAuthentication(begun.ceremony, wrong)).toEqual(FAILED);
			const right = authenticator.assert(begun.options.challenge);
			expect(await finishAuthentication(begun.ceremony, right)).toEqual(FAILED);
		});

		it('an expired challenge', async () => {
			const { authenticator } = await pilotWithPasskey();
			const begun = await beginAuthentication();
			if (!begun) throw new Error('unavailable');
			const response = authenticator.assert(begun.options.challenge);
			expect(
				await finishAuthentication(begun.ceremony, response, Date.now() + CHALLENGE_LIFETIME_MS + 1)
			).toEqual(FAILED);
		});

		it('a challenge someone else answered — the wrong challenge for this ceremony', async () => {
			const { authenticator } = await pilotWithPasskey();
			const mine = await beginAuthentication();
			const theirs = await beginAuthentication();
			if (!mine || !theirs) throw new Error('unavailable');
			const response = authenticator.assert(theirs.options.challenge);
			expect(await finishAuthentication(mine.ceremony, response)).toEqual(FAILED);
		});

		it('a registration challenge used to sign in', async () => {
			const { user, token, authenticator } = await pilotWithPasskey();
			const begun = await beginRegistration(user, token, null);
			if (!begun.ok) throw new Error('could not begin');
			const response = authenticator.assert(begun.options.challenge);
			expect(await finishAuthentication(begun.ceremony, response)).toEqual(FAILED);
		});

		it('a counter that goes backwards', async () => {
			const { authenticator } = await pilotWithPasskey();
			authenticator.counter = 5;
			expect((await signIn(authenticator)).ok).toBe(true);
			authenticator.counter = 4;
			expect(await signIn(authenticator)).toEqual(FAILED);
		});

		it('a counter that stands still on a credential that keeps one', async () => {
			const { authenticator } = await pilotWithPasskey();
			authenticator.counter = 5;
			expect((await signIn(authenticator)).ok).toBe(true);
			expect(await signIn(authenticator)).toEqual(FAILED);
		});

		it('a user handle that is not the owner', async () => {
			const { authenticator } = await pilotWithPasskey();
			authenticator.userHandle = Buffer.from('someone-else').toString('base64url');
			expect(await signIn(authenticator)).toEqual(FAILED);
		});

		it('no ceremony at all', async () => {
			const { authenticator } = await pilotWithPasskey();
			const begun = await beginAuthentication();
			if (!begun) throw new Error('unavailable');
			const response = authenticator.assert(begun.options.challenge);
			expect(await finishAuthentication(null, response)).toEqual(FAILED);
			expect(await finishAuthentication('made-up', response)).toEqual(FAILED);
		});

		it('garbage', async () => {
			const begun = await beginAuthentication();
			if (!begun) throw new Error('unavailable');
			expect(await finishAuthentication(begun.ceremony, { id: 'x' })).toEqual(FAILED);
		});
	});
});

describe('the passkey list', () => {
	it('renames, but only your own', async () => {
		const { user, authenticator } = await pilotWithPasskey();
		const other = await pilot();
		expect(await renamePasskey(other.user.id, authenticator.id, 'Mine now')).toBe(false);
		expect(await renamePasskey(user.id, authenticator.id, '  Work phone  ')).toBe(true);
		const [passkey] = await listPasskeys(user.id);
		expect(passkey.name).toBe('Work phone');
		// Where it was made is kept.
		expect(passkey.createdOn).toBe('Safari on iPhone');
	});

	it('removes behind the same recent-sign-in guard as adding', async () => {
		const { user, token, authenticator } = await pilotWithPasskey();
		await age(token, RECENT_SIGN_IN_MS + 1_000);

		expect(await removePasskey(user.id, token, null, authenticator.id)).toEqual({
			ok: false,
			reason: 'reauthenticate'
		});
		expect(await passkeyCount(user.id)).toBe(1);

		expect(await removePasskey(user.id, token, PASSWORD, authenticator.id)).toEqual({ ok: true });
		expect(await passkeyCount(user.id)).toBe(0);
	});

	it('never removes somebody else’s', async () => {
		const owner = await pilotWithPasskey();
		const other = await pilot();
		expect(await removePasskey(other.user.id, other.token, null, owner.authenticator.id)).toEqual({
			ok: false,
			reason: 'not-found'
		});
		expect(await passkeyCount(owner.user.id)).toBe(1);
	});

	it('a removed passkey no longer signs in', async () => {
		const { user, token, authenticator } = await pilotWithPasskey();
		await removePasskey(user.id, token, null, authenticator.id);
		expect(await signIn(authenticator)).toEqual({ ok: false });
	});
});

/** The rules in the spec under "Things that must not change". */
describe('what leaves passkeys alone', () => {
	it('changing the password', async () => {
		const { user, token, authenticator } = await pilotWithPasskey();
		const result = await changePassword(user.id, PASSWORD, 'a-new-password-99', token);
		expect(result.ok).toBe(true);
		expect(await passkeyCount(user.id)).toBe(1);
		expect((await signIn(authenticator)).ok).toBe(true);
	});

	it('resetting the password', async () => {
		const { user, authenticator } = await pilotWithPasskey();
		const reset = await createPasswordReset(user.email);
		if (!reset) throw new Error('no reset');
		expect(await completePasswordReset(reset.token, 'a-new-password-99')).toEqual({ ok: true });
		expect(await passkeyCount(user.id)).toBe(1);
		expect((await signIn(authenticator)).ok).toBe(true);
	});

	it('signing out other sessions', async () => {
		const { user, token, authenticator } = await pilotWithPasskey();
		await createSession(user.id, IPHONE);
		expect(await revokeOtherSessions(user.id, token)).toBe(1);
		expect(await passkeyCount(user.id)).toBe(1);
		expect((await signIn(authenticator)).ok).toBe(true);
	});
});

describe('deleting the account', () => {
	it('takes its passkeys and ceremonies with it, through the cascade', async () => {
		const { user, token, authenticator } = await pilotWithPasskey();
		// A registration left half-finished.
		await beginRegistration(user, token, null);
		expect(
			(await db.select().from(webauthnChallenges).where(eq(webauthnChallenges.userId, user.id)))
				.length
		).toBe(1);

		expect(await deleteAccount(user.id, user.email)).toBe(true);
		expect(await db.select().from(passkeys).where(eq(passkeys.userId, user.id))).toEqual([]);
		expect(
			await db.select().from(webauthnChallenges).where(eq(webauthnChallenges.userId, user.id))
		).toEqual([]);
		expect(await signIn(authenticator)).toEqual({ ok: false });
	});
});

describe('the export', () => {
	it('never carries the passkeys table', async () => {
		const { user, authenticator } = await pilotWithPasskey();
		const bundle = await exportBundle(user.id);
		if (!bundle) throw new Error('no bundle');
		const serialised = serializeBundle(bundle);

		const [row] = await db.select().from(passkeys).where(eq(passkeys.id, authenticator.id));
		for (const needle of [
			'passkeys',
			'publicKey',
			'public_key',
			'transports',
			authenticator.id,
			row.publicKey.toString('base64'),
			row.publicKey.toString('base64url'),
			row.name
		]) {
			expect(serialised).not.toContain(needle);
		}
		expect(Object.keys(bundle)).not.toContain('passkeys');
	});
});
