import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

/**
 * A software authenticator for unit tests: it builds the responses a browser
 * would hand back, signed with a real P-256 key, so `@simplewebauthn/server`
 * verifies them for real. It only ever writes WebAuthn, never reads it — the
 * server side still parses nothing by hand.
 *
 * Attestation is `none`, user presence and verification are always asserted,
 * and the signature counter is whatever the test sets.
 */

/* A just-enough CBOR encoder: unsigned and negative integers, byte and text
   strings, and maps — everything an attestation object and a COSE key use. */
function head(major: number, length: number): Buffer {
	if (length < 24) return Buffer.from([(major << 5) | length]);
	if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
	if (length < 0x10000) {
		const out = Buffer.alloc(3);
		out[0] = (major << 5) | 25;
		out.writeUInt16BE(length, 1);
		return out;
	}
	const out = Buffer.alloc(5);
	out[0] = (major << 5) | 26;
	out.writeUInt32BE(length, 1);
	return out;
}

type Cbor = number | string | Buffer | Map<number | string, Cbor>;

function cbor(value: Cbor): Buffer {
	if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
	if (typeof value === 'string') {
		const bytes = Buffer.from(value, 'utf8');
		return Buffer.concat([head(3, bytes.length), bytes]);
	}
	if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
	const parts = [head(5, value.size)];
	for (const [key, item] of value) parts.push(cbor(key), cbor(item));
	return Buffer.concat(parts);
}

function sha256(data: Buffer | string): Buffer {
	return createHash('sha256').update(data).digest();
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface SoftwareAuthenticatorOptions {
	rpId: string;
	origin: string;
}

export class SoftwareAuthenticator {
	readonly credentialId = randomBytes(16);
	readonly #privateKey: KeyObject;
	readonly #publicKey: KeyObject;
	/** The counter the next assertion reports. Zero means "this one keeps no counter". */
	counter = 0;
	/** Who the authenticator thinks the credential belongs to, set at registration. */
	userHandle: string | undefined;

	constructor(readonly options: SoftwareAuthenticatorOptions) {
		const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		this.#privateKey = pair.privateKey;
		this.#publicKey = pair.publicKey;
	}

	get id(): string {
		return this.credentialId.toString('base64url');
	}

	#coseKey(): Buffer {
		const jwk = this.#publicKey.export({ format: 'jwk' });
		return cbor(
			new Map<number, Cbor>([
				[1, 2], // kty: EC2
				[3, -7], // alg: ES256
				[-1, 1], // crv: P-256
				[-2, Buffer.from(jwk.x!, 'base64url')],
				[-3, Buffer.from(jwk.y!, 'base64url')]
			])
		);
	}

	#authData(flags: number, attested: Buffer | null, rpId = this.options.rpId): Buffer {
		const counter = Buffer.alloc(4);
		counter.writeUInt32BE(this.counter);
		return Buffer.concat([
			sha256(rpId),
			Buffer.from([flags]),
			counter,
			attested ?? Buffer.alloc(0)
		]);
	}

	#clientData(type: string, challenge: string, origin = this.options.origin): Buffer {
		return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
	}

	/** What `startRegistration()` would resolve with for these creation options. */
	register(
		options: { challenge: string; user: { id: string } },
		overrides: { origin?: string } = {}
	) {
		this.userHandle = options.user.id;
		const idLength = Buffer.alloc(2);
		idLength.writeUInt16BE(this.credentialId.length);
		const attested = Buffer.concat([
			Buffer.alloc(16), // AAGUID: none
			idLength,
			this.credentialId,
			this.#coseKey()
		]);
		const authData = this.#authData(FLAG_UP | FLAG_UV | FLAG_AT, attested);
		const attestationObject = cbor(
			new Map<string, Cbor>([
				['fmt', 'none'],
				['attStmt', new Map()],
				['authData', authData]
			])
		);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key' as const,
			clientExtensionResults: {},
			response: {
				clientDataJSON: this.#clientData(
					'webauthn.create',
					options.challenge,
					overrides.origin
				).toString('base64url'),
				attestationObject: attestationObject.toString('base64url'),
				transports: ['internal']
			}
		};
	}

	/** What `startAuthentication()` would resolve with for this challenge. */
	assert(challenge: string, overrides: { origin?: string; rpId?: string } = {}) {
		const authData = this.#authData(FLAG_UP | FLAG_UV, null, overrides.rpId);
		const clientDataJSON = this.#clientData('webauthn.get', challenge, overrides.origin);
		const signature = sign(
			'sha256',
			Buffer.concat([authData, sha256(clientDataJSON)]),
			this.#privateKey
		);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key' as const,
			clientExtensionResults: {},
			response: {
				clientDataJSON: clientDataJSON.toString('base64url'),
				authenticatorData: authData.toString('base64url'),
				signature: signature.toString('base64url'),
				...(this.userHandle ? { userHandle: this.userHandle } : {})
			}
		};
	}
}
