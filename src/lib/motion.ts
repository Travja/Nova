/**
 * Whether the app may move things by itself, for anything the global rule in
 * `app.css` cannot reach.
 *
 * That rule damps every CSS animation and transition, which covers every dial.
 * A WebGL canvas draws with neither, so a canvas has to ask. The answer is the
 * same one the CSS gives: the account's `motion` preference, stamped on
 * `<html>` as `data-motion`, when it is an explicit choice — `full` animates,
 * `reduced` and `none` still it — and the operating system's
 * `prefers-reduced-motion` when it is `system` or missing.
 *
 * Browser-only: it reads the document. Kept here rather than inside the
 * universe (#11, decision 11) so the next canvas does not re-derive it.
 */

const REDUCE = '(prefers-reduced-motion: reduce)';

export function motionAllowed(): boolean {
	const choice = document.documentElement.dataset.motion;
	if (choice === 'full') return true;
	if (choice === 'reduced' || choice === 'none') return false;
	return !window.matchMedia(REDUCE).matches;
}

/**
 * Call `listener` with the new answer whenever either input changes — the
 * operating system's setting, or the preference being saved from settings,
 * which re-stamps `<html>` without a reload. Returns the unsubscribe.
 */
export function onMotionChange(listener: (allowed: boolean) => void): () => void {
	let last = motionAllowed();
	const check = () => {
		const next = motionAllowed();
		if (next === last) return;
		last = next;
		listener(next);
	};

	const query = window.matchMedia(REDUCE);
	query.addEventListener('change', check);
	const observer = new MutationObserver(check);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-motion']
	});

	return () => {
		query.removeEventListener('change', check);
		observer.disconnect();
	};
}
