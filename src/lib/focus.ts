/**
 * Where focus goes when the thing holding it leaves the screen.
 *
 * Several surfaces in Nova remove the very control the user is standing on:
 * revoking a session deletes its row, syncing the offline queue empties the bar
 * the "Sync now" button lives in, and dismissing the update prompt takes the
 * dismiss button with it. Left alone the browser drops focus on `<body>`, which
 * costs a keyboard user their place in the document and a screen-reader user
 * any idea that anything happened at all.
 *
 * Two rules, and no third:
 *
 * - If something related survives, focus that — the sessions list is still
 *   there after one of its rows goes, so `/settings/security` focuses it.
 * - If nothing does, focus the start of the main content. The transient bars
 *   sit above the masthead, so `<main>` is forward of where the user was and
 *   tabbing on carries them into the page rather than back out of it.
 *
 * Both need a focus target that is not itself a control, which is what
 * `tabindex="-1"` is for: reachable by script, never by the tab key.
 */

/** The id `+layout.svelte` puts on `<main>`. */
export const MAIN_ID = 'main-content';

/** True while the user's focus is inside `node` — checked before removing it. */
export function holdsFocus(node: HTMLElement | null | undefined): boolean {
	if (!node || typeof document === 'undefined') return false;
	return node === document.activeElement || node.contains(document.activeElement);
}

/**
 * Move focus to an element that is not normally focusable.
 *
 * `preventScroll` because these are recoveries, not navigations: the page is
 * where the user left it and jumping it under them is its own small betrayal.
 */
export function focusTarget(node: HTMLElement | null | undefined): void {
	node?.focus({ preventScroll: true });
}

/** The fallback: the top of the page's own content. */
export function focusMain(): void {
	if (typeof document === 'undefined') return;
	focusTarget(document.getElementById(MAIN_ID));
}
