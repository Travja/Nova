/**
 * Renders Nova's PWA icons without pulling in an image library.
 *
 * The artwork is simple enough to rasterise by hand — a deep-space disc, an
 * orbit ring and a body on it — and a hand-rolled PNG encoder keeps the
 * dependency list short. Run with `pnpm icons` after changing the design.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'static/icons');

function crc32(buffer) {
	let crc = ~0;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return ~crc >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** Encode RGBA pixel data as a PNG. */
function encodePng(width, height, pixels) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // truecolour with alpha
	// Each scanline is prefixed with filter type 0 (none).
	const raw = Buffer.alloc(height * (width * 4 + 1));
	for (let y = 0; y < height; y += 1) {
		raw[y * (width * 4 + 1)] = 0;
		pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const hex = (value) => [
	parseInt(value.slice(1, 3), 16),
	parseInt(value.slice(3, 5), 16),
	parseInt(value.slice(5, 7), 16)
];

const BACKDROP_OUTER = hex('#04050d');
const BACKDROP_INNER = hex('#1b2350');
const RING = hex('#7dd3fc');
const BODY = hex('#a78bfa');
const CORE = hex('#fbbf24');

function mix(a, b, t) {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t)
	];
}

/** Coverage of a disc at a pixel, sampled 3x3 for cheap antialiasing. */
function discCoverage(x, y, cx, cy, radius) {
	let hits = 0;
	for (let sx = 0; sx < 3; sx += 1) {
		for (let sy = 0; sy < 3; sy += 1) {
			const px = x + (sx + 0.5) / 3;
			const py = y + (sy + 0.5) / 3;
			if (Math.hypot(px - cx, py - cy) <= radius) hits += 1;
		}
	}
	return hits / 9;
}

function ringCoverage(x, y, cx, cy, radius, thickness) {
	let hits = 0;
	for (let sx = 0; sx < 3; sx += 1) {
		for (let sy = 0; sy < 3; sy += 1) {
			const distance = Math.hypot(x + (sx + 0.5) / 3 - cx, y + (sy + 0.5) / 3 - cy);
			if (Math.abs(distance - radius) <= thickness / 2) hits += 1;
		}
	}
	return hits / 9;
}

function blend(target, offset, color, alpha) {
	for (let channel = 0; channel < 3; channel += 1) {
		target[offset + channel] = Math.round(
			target[offset + channel] * (1 - alpha) + color[channel] * alpha
		);
	}
	target[offset + 3] = Math.max(target[offset + 3], Math.round(255 * alpha));
}

function render(size, { maskable }) {
	const pixels = Buffer.alloc(size * size * 4);
	const center = size / 2;
	// Maskable icons must survive a circular crop, so the art shrinks into the
	// safe zone while the backdrop fills the full square.
	const artScale = maskable ? 0.62 : 0.86;
	const backdropRadius = maskable ? size : size * 0.5;
	const orbitRadius = (size * artScale) / 2.6;

	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const offset = (y * size + x) * 4;
			const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);

			const backdropAlpha = maskable ? 1 : discCoverage(x, y, center, center, backdropRadius);
			if (backdropAlpha > 0) {
				const t = Math.min(1, distance / (size * 0.55));
				blend(pixels, offset, mix(BACKDROP_INNER, BACKDROP_OUTER, t), backdropAlpha);
			}

			const ringAlpha = ringCoverage(x, y, center, center, orbitRadius, size * 0.035);
			if (ringAlpha > 0) blend(pixels, offset, RING, ringAlpha * 0.65);

			const coreAlpha = discCoverage(x, y, center, center, size * artScale * 0.11);
			if (coreAlpha > 0) blend(pixels, offset, CORE, coreAlpha);

			// The body sits at roughly one o'clock on its orbit.
			const bodyX = center + orbitRadius * Math.sin(Math.PI / 4);
			const bodyY = center - orbitRadius * Math.cos(Math.PI / 4);
			const bodyAlpha = discCoverage(x, y, bodyX, bodyY, size * artScale * 0.09);
			if (bodyAlpha > 0) blend(pixels, offset, BODY, bodyAlpha);
		}
	}

	return encodePng(size, size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
	['icon-192.png', 192, { maskable: false }],
	['icon-512.png', 512, { maskable: false }],
	['icon-maskable-512.png', 512, { maskable: true }],
	['apple-touch-icon.png', 180, { maskable: true }]
];

for (const [name, size, options] of targets) {
	const path = resolve(OUT_DIR, name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, render(size, options));
	console.log(`wrote ${path}`);
}
