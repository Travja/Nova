/**
 * FNV-1a, which is short, has no dependencies and scatters ids that differ by a
 * character or two — which is exactly what a run of uuids does.
 *
 * Lives on its own because two things now seed from it: `bodyVariant` (which
 * body a goal flies) and `$domain/universe` (anchor angles, tilts and belt rock
 * placement). Neither owns it.
 */
export function hash(key: string): number {
	let value = 2_166_136_261;
	for (let index = 0; index < key.length; index += 1) {
		value ^= key.charCodeAt(index);
		// The FNV prime, by shifts, so this stays inside 32 bits.
		value =
			(value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
	}
	return value >>> 0;
}
