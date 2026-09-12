import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters follow the OWASP password storage recommendations:
 * 19 MiB of memory, two iterations, one lane.
 */
const options = {
	memoryCost: 19_456,
	timeCost: 2,
	outputLen: 32,
	parallelism: 1
};

export function hashPassword(password: string): Promise<string> {
	return hash(password, options);
}

export async function verifyPassword(digest: string, password: string): Promise<boolean> {
	try {
		return await verify(digest, password, options);
	} catch {
		// A malformed digest means the stored hash is unusable, not that the
		// password matched.
		return false;
	}
}
