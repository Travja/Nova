import { logger } from '$lib/server/log';
import type { VapidSettings } from './config';

/**
 * Handing one encrypted payload to one push service.
 *
 * This is the only place that knows Web Push exists. It makes no decisions
 * about who to send to or what to say — `$domain/reminders` does that — and it
 * reports back in the one vocabulary the caller needs: it arrived, the device
 * is gone, or it failed and may be worth trying again another time.
 *
 * `web-push` rather than our own RFC 8291: the payload is encrypted with
 * ECDH over P-256, HKDF and AES-128-GCM, and the request is signed with a
 * VAPID JWT. Node has every primitive, so this is perhaps 150 lines — but they
 * are 150 lines of cryptographic plumbing whose failure mode is silence on
 * somebody's phone, and the library is the widely used implementation of
 * exactly that. It is imported lazily below, so an instance with no keys never
 * loads it.
 */

export interface PushTarget {
	endpoint: string;
	p256dh: string;
	auth: string;
}

/**
 * What became of one send.
 *
 * `gone` is the one that matters: a push service answers 404 or 410 when the
 * subscription has been revoked or has expired, and that is final. Retrying it
 * forever is how a push sender ends up rate-limited by a service it is only
 * ever asking to deliver to a device that no longer exists, so the caller
 * deletes the row instead.
 */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Long enough to survive a phone being off overnight, short enough to stay news. */
const TTL_SECONDS = 6 * 60 * 60;

function statusOf(error: unknown): number | null {
	const status = (error as { statusCode?: unknown })?.statusCode;
	return typeof status === 'number' ? status : null;
}

export async function sendPush(
	vapid: VapidSettings,
	target: PushTarget,
	payload: unknown
): Promise<PushOutcome> {
	const { default: webpush } = await import('web-push');

	try {
		await webpush.sendNotification(
			{ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
			JSON.stringify(payload),
			{
				TTL: TTL_SECONDS,
				vapidDetails: {
					subject: vapid.subject,
					publicKey: vapid.publicKey,
					privateKey: vapid.privateKey
				}
			}
		);
		return 'sent';
	} catch (error) {
		const status = statusOf(error);
		if (status === 404 || status === 410) return 'gone';

		// Everything else is the operator's problem rather than the device's: a
		// 403 is keys that do not match the subscription, a 413 a payload the
		// service will not carry, a 429 too many sends. The endpoint is logged
		// rather than the payload — the payload is the reminder.
		logger.warn('push send failed', { status, endpoint: target.endpoint, error });
		return 'failed';
	}
}
