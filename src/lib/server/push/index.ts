import {
	alreadyRemindedToday,
	inQuietHours,
	reminderFor,
	reminderMessage,
	type ReminderMessage
} from '$domain/reminders';
import { listGoalSnapshots } from '$lib/server/goals';
import type { SessionUser } from '$lib/server/auth/session';
import { logger } from '$lib/server/log';
import { partiallyConfigured, readPushConfig, type VapidSettings } from './config';
import { sendPush } from './send';
import {
	deleteExpiredSubscriptions,
	listReminderTargets,
	listSubscriptions,
	markDelivered,
	markReminded,
	type ReminderTarget
} from './store';

/**
 * Reminders, from the schedule down to one device.
 *
 * The decisions are all in `$domain/reminders` — who is worth interrupting,
 * whether the hour allows it, what the notification reads. This is the part
 * that has a database and a clock: it walks the accounts that asked to be
 * reminded, applies those rules to each one's own snapshots, and hands the
 * result to the push service.
 *
 * Off unless VAPID keys are configured, the way mail is off without
 * `SMTP_HOST`. Nothing here runs, nothing is offered in settings, and no
 * network is reached.
 */

const config = readPushConfig();

/** Whether this instance can send reminders at all. */
export const remindersConfigured = config.kind === 'vapid';

/** Handed to browsers so they can subscribe. Public by design; null when off. */
export const vapidPublicKey = config.kind === 'vapid' ? config.vapid.publicKey : null;

if (partiallyConfigured()) {
	logger.warn('push reminders are off: VAPID configuration is incomplete', {
		hint: 'Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, and a VAPID_SUBJECT or ORIGIN.'
	});
}

export interface DeliveryResult {
	sent: number;
	/** Subscriptions the push service says are gone. Already deleted. */
	expired: number;
	failed: number;
}

/**
 * Send one message to every device an account has, and tidy up after it.
 *
 * A 404 or a 410 means that subscription is dead — the browser was reinstalled,
 * the user revoked permission, the push service expired it — so the row goes
 * rather than being retried forever. Anything else is left alone: a 500 from a
 * push service is that service's bad afternoon, not a reason to lose a device.
 */
async function deliver(
	vapid: VapidSettings,
	devices: ReminderTarget['devices'],
	message: ReminderMessage,
	now: Date
): Promise<DeliveryResult> {
	const payload = {
		title: message.title,
		body: message.body,
		tag: message.tag,
		url: message.url
	};

	const outcomes = await Promise.all(
		devices.map(async (device) => ({
			endpoint: device.endpoint,
			outcome: await sendPush(vapid, device, payload)
		}))
	);

	const sent = outcomes.filter((each) => each.outcome === 'sent');
	const expired = outcomes.filter((each) => each.outcome === 'gone');

	await markDelivered(
		sent.map((each) => each.endpoint),
		now
	);
	await deleteExpiredSubscriptions(expired.map((each) => each.endpoint));

	return {
		sent: sent.length,
		expired: expired.length,
		failed: outcomes.length - sent.length - expired.length
	};
}

export interface SweepSummary {
	considered: number;
	/** Accounts a reminder actually went out to. */
	reminded: number;
	sent: number;
	expired: number;
}

/**
 * One pass over everyone who asked to be reminded.
 *
 * The order of the guards is the order they cost: quiet hours and the daily cap
 * are two comparisons, and a snapshot is a query per account, so nobody's goals
 * are loaded to discover that it is three in the morning where they are.
 *
 * A sweep that sends nothing is the normal outcome and is not an error. The
 * whole point of the cap is that most passes have nothing to say.
 */
export async function sendReminders(now: Date = new Date()): Promise<SweepSummary> {
	if (config.kind !== 'vapid') return { considered: 0, reminded: 0, sent: 0, expired: 0 };

	const targets = await listReminderTargets();
	const summary: SweepSummary = { considered: targets.length, reminded: 0, sent: 0, expired: 0 };

	for (const target of targets) {
		const { user, settings } = target;
		if (inQuietHours(now, user.timeZone, settings.quiet)) continue;
		if (alreadyRemindedToday(settings.lastSentAt, now, user.timeZone)) continue;

		const reminder = reminderFor(await listGoalSnapshots(user, now), now);
		if (!reminder) continue;

		const result = await deliver(config.vapid, target.devices, reminderMessage(reminder), now);
		summary.sent += result.sent;
		summary.expired += result.expired;

		// The cap is spent on a reminder that reached a device, not on one every
		// device refused: a failed send is not a nudge anybody received.
		if (result.sent > 0) {
			await markReminded(user.id, now);
			summary.reminded += 1;
			logger.info('reminder sent', {
				userId: user.id,
				kind: reminder.kind,
				cadence: reminder.cadence,
				count: reminder.count,
				devices: result.sent
			});
		}
	}

	return summary;
}

/**
 * What the "Send a test" button sends.
 *
 * Deliberately outside quiet hours and the daily cap: the user is standing
 * there asking for it, and the question it answers — did this device's
 * subscription actually work — cannot be answered by anything that waits.
 */
export async function sendTestReminder(user: SessionUser): Promise<DeliveryResult> {
	if (config.kind !== 'vapid') return { sent: 0, expired: 0, failed: 0 };

	// This account's devices directly rather than through the sweep's list, which
	// is filtered by "reminders on": testing a device before switching reminders
	// on is the normal way round.
	return deliver(
		config.vapid,
		await listSubscriptions(user.id),
		{
			title: 'Reminders are on',
			body: 'This is what a nudge from Nova looks like.',
			tag: 'nova-test',
			url: '/today'
		},
		new Date()
	);
}

/**
 * How often the sweep runs.
 *
 * Reminders are hour-shaped, not minute-shaped — "late in the day", "quiet
 * after ten" — so a quarter of an hour is as fine-grained as any of the rules
 * can use, and it keeps the cost of a pass down to one query on an instance
 * where nobody has opted in.
 */
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
/** Long enough to let the server finish booting, as the backup schedule does. */
const FIRST_RUN_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | undefined;

async function sweep(): Promise<void> {
	try {
		const summary = await sendReminders();
		const fields = { ...summary };
		if (summary.reminded > 0 || summary.expired > 0) logger.info('reminder sweep', fields);
		else logger.debug('reminder sweep', fields);
	} catch (error) {
		// A failed sweep is loud but never fatal: the app keeps serving, and the
		// next pass is fifteen minutes away.
		logger.error('reminder sweep failed', { error });
	}
}

/**
 * Start the sweep. Idempotent, and the timer is unref'd so it never holds the
 * process open on shutdown — both as `startBackupSchedule()` does.
 */
export function startReminderSchedule(): boolean {
	if (config.kind !== 'vapid' || timer) return false;

	logger.info('reminder schedule started', { intervalMinutes: SWEEP_INTERVAL_MS / 60_000 });

	const first = setTimeout(() => void sweep(), FIRST_RUN_DELAY_MS);
	first.unref?.();
	timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
	timer.unref?.();
	return true;
}

export function stopReminderSchedule(): void {
	if (timer) clearInterval(timer);
	timer = undefined;
}
