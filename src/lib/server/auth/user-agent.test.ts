import { describe, expect, it } from 'vitest';
import { describeDevice, UNKNOWN_DEVICE } from './user-agent';

describe('describeDevice', () => {
	it('names the browser and the platform', () => {
		expect(
			describeDevice(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
			)
		).toBe('Chrome on macOS');

		expect(
			describeDevice(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
			)
		).toBe('Safari on iPhone');

		expect(
			describeDevice(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
			)
		).toBe('Firefox on Windows');
	});

	it('prefers the more specific browser when several strings are present', () => {
		// Every Chromium browser claims Chrome and Safari as well as itself.
		expect(
			describeDevice(
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
			)
		).toBe('Edge on Windows');

		expect(
			describeDevice(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
			)
		).toBe('Chrome on iPhone');
	});

	it('falls back to whichever half it recognises', () => {
		expect(describeDevice('curl/8.5.0')).toBe(UNKNOWN_DEVICE);
		expect(describeDevice('Something/1.0 (Linux)')).toBe('Linux');
	});

	it('handles a missing user agent', () => {
		expect(describeDevice(null)).toBe(UNKNOWN_DEVICE);
		expect(describeDevice('')).toBe(UNKNOWN_DEVICE);
	});
});
