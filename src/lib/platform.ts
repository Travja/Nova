/**
 * The handful of facts about the browser that decide what a page may offer.
 *
 * All of them need `navigator` or `matchMedia`, neither of which exists during
 * server rendering, so every one of these answers `false` on the server and the
 * components that use them start hidden and reveal after mount. That costs a
 * frame; guessing in markup costs a hydration mismatch.
 *
 * They live here rather than in the two components that ask because the two
 * questions are the same question: iOS delivers push only to an installed PWA,
 * so the install hint and the reminder opt-in have to agree about what an
 * installed iOS PWA looks like.
 */

/** Whether we are in a browser at all. */
function inBrowser(): boolean {
	return typeof navigator !== 'undefined' && typeof window !== 'undefined';
}

/** An iPhone or an iPad, whichever browser is wrapped around it. */
export function isIos(): boolean {
	if (!inBrowser()) return false;
	const ua = navigator.userAgent;
	// iPadOS reports itself as a Mac; the touch points give it away.
	const iPadOnDesktopUa = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
	return (/iphone|ipad|ipod/i.test(ua) || iPadOnDesktopUa) && !('MSStream' in window);
}

/**
 * Mobile Safari specifically, which is the only iOS browser that can install.
 *
 * Other iOS browsers embed Safari's engine and still say "Safari" in their UA
 * string, so the ones that add their own name have to be ruled out explicitly
 * rather than matched in.
 */
export function isIosSafari(): boolean {
	if (!isIos()) return false;
	const ua = navigator.userAgent;
	return /safari/i.test(ua) && !/crios|fxios|edgios|opios|duckduckgo/i.test(ua);
}

/** Running from the home screen rather than in a browser tab. */
export function isStandalone(): boolean {
	if (!inBrowser()) return false;
	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

/**
 * Whether this browser can subscribe to push at all.
 *
 * On iOS every one of these is missing until the app is on the home screen,
 * which is why the opt-in explains that rather than offering a button that
 * throws.
 */
export function pushSupported(): boolean {
	return (
		inBrowser() &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/**
 * A VAPID public key as `pushManager.subscribe()` wants it.
 *
 * The server hands it over as base64url, which is what every tool that
 * generates one prints; the API takes bytes. The padding has to be put back
 * before `atob` will look at it.
 */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
	const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
	const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
	// Backed by a plain `ArrayBuffer` rather than `Uint8Array.from`, whose
	// buffer type is wide enough that `subscribe()` will not take it.
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
