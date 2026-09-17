/*
 * The service worker's half of reminders: showing one, and answering the tap.
 *
 * This is a separate file that the generated worker pulls in with
 * `importScripts` (see `workbox.importScripts` in vite.config.ts) rather than
 * a custom worker. That is deliberate. Nova's worker is Workbox's
 * `generateSW`, which already carries the precache, the Background Sync queue
 * the offline log flushes through, and the `SKIP_WAITING` message listener
 * that `UpdatePrompt.svelte` talks to. Swapping to `injectManifest` to add
 * twenty lines would mean owning all of that by hand, and the update prompt
 * would break silently — nothing fails loudly when a message listener goes
 * missing. Adding a script keeps every one of those untouched.
 *
 * It is plain JavaScript, served as a static file: nothing here is bundled, so
 * it imports nothing and uses only what a worker already has.
 */

/**
 * A reminder arriving.
 *
 * The payload is JSON that `$domain/reminders` wrote, and it deliberately
 * carries no goal titles — see that module for why. Anything unreadable still
 * shows something: a browser that grants push permission expects a
 * notification for every message, and showing nothing risks the permission
 * being revoked.
 */
self.addEventListener('push', (event) => {
	let payload = {};
	try {
		payload = event.data ? event.data.json() : {};
	} catch {
		payload = {};
	}

	const title = payload.title || 'Nova';
	const options = {
		body: payload.body || 'Something is running out of time today.',
		// One reminder at a time: a new one replaces the unread one rather than
		// stacking a pile of nudges nobody reads.
		tag: payload.tag || 'nova-reminder',
		renotify: false,
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		data: { url: payload.url || '/today' }
	};

	event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * The tap.
 *
 * An already-open Nova is focused and navigated rather than a second window
 * opened beside it — which is also what makes the payload's thinness fine: the
 * app fetches whatever the reminder was about, from a session, once the tap has
 * gone through.
 */
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data && event.notification.data.url) || '/today';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if (new URL(client.url).origin !== self.location.origin) continue;
				return (
					client
						.focus()
						.then((focused) => focused.navigate(url))
						// `navigate()` rejects for a window this worker does not control,
						// which is one reload away from never happening — opening a window
						// is worse than focusing one, and far better than a tap that does
						// nothing at all.
						.catch(() => self.clients.openWindow(url))
				);
			}
			return self.clients.openWindow(url);
		})
	);
});
