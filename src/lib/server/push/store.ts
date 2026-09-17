import { newId } from '$lib/server/auth/session';
import type { SessionUser } from '$lib/server/auth/session';
import { describeDevice } from '$lib/server/auth/user-agent';
import { db } from '$lib/server/db';
import {
	pushSubscriptions,
	reminderSettings,
	users,
	type PushSubscriptionRow,
	type UserRow
} from '$lib/server/db/schema';
import { readPreferences } from '$domain/preferences';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '$domain/reminders';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Where reminder state lives: which devices have agreed to be interrupted, and
 * on what terms.
 *
 * Ownership is checked in here rather than in the routes, the way `logEntry()`
 * does it — a subscription id or an endpoint arriving from anywhere is only
 * ever acted on under the user it belongs to.
 */

/** How long a user agent may be before it is stored truncated — as sessions do. */
const USER_AGENT_MAX = 400;

export interface SubscriptionInput {
	endpoint: string;
	p256dh: string;
	auth: string;
	userAgent?: string | null;
}

export interface DeviceSummary {
	id: string;
	/** What the settings list calls it: "Safari on iPhone", and so on. */
	device: string;
	createdAt: Date;
	lastSentAt: Date | null;
}

/**
 * Record a device's subscription, or refresh the one it already had.
 *
 * A browser re-subscribes whenever its push service rotates the endpoint, and
 * the same browser profile signing in as somebody else hands back the endpoint
 * it already had. Conflicting on the endpoint covers both: the row moves to
 * whoever is signed in now and picks up the current keys, rather than leaving a
 * second account quietly pushing to the same device.
 */
export async function saveSubscription(userId: string, input: SubscriptionInput): Promise<void> {
	const userAgent = input.userAgent?.slice(0, USER_AGENT_MAX) ?? null;
	await db
		.insert(pushSubscriptions)
		.values({
			id: newId(),
			userId,
			endpoint: input.endpoint,
			p256dh: input.p256dh,
			auth: input.auth,
			userAgent,
			createdAt: new Date(),
			lastSentAt: null
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: { userId, p256dh: input.p256dh, auth: input.auth, userAgent }
		});
}

/** Forget one device. Opting out is this, plus the browser's own unsubscribe. */
export async function deleteSubscription(userId: string, endpoint: string): Promise<boolean> {
	const result = await db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
	return result.changes > 0;
}

/** Forget one device by the id the settings list shows, under its owner. */
export async function deleteDevice(userId: string, id: string): Promise<boolean> {
	const result = await db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)));
	return result.changes > 0;
}

/**
 * Forget a device the push service has told us is gone.
 *
 * No user id, because this is not a user's decision: a 404 or a 410 means the
 * endpoint is dead whoever it belonged to, and the row is scoped by the
 * endpoint it was found under in the first place.
 */
export async function deleteExpiredSubscriptions(endpoints: readonly string[]): Promise<number> {
	if (endpoints.length === 0) return 0;
	const result = await db
		.delete(pushSubscriptions)
		.where(inArray(pushSubscriptions.endpoint, [...endpoints]));
	return result.changes;
}

/** This account's subscriptions as they are stored — what the sender needs. */
export async function listSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
	return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export async function listDevices(userId: string): Promise<DeviceSummary[]> {
	const rows = await listSubscriptions(userId);

	return rows.map((row) => ({
		id: row.id,
		device: describeDevice(row.userAgent),
		createdAt: row.createdAt,
		lastSentAt: row.lastSentAt
	}));
}

export interface ReminderSettings {
	enabled: boolean;
	quiet: QuietHours;
	lastSentAt: Date | null;
}

/** Off, with the default quiet hours, is what an account that has never asked gets. */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
	enabled: false,
	quiet: DEFAULT_QUIET_HOURS,
	lastSentAt: null
};

export async function readReminderSettings(userId: string): Promise<ReminderSettings> {
	const [row] = await db
		.select()
		.from(reminderSettings)
		.where(eq(reminderSettings.userId, userId))
		.limit(1);
	if (!row) return DEFAULT_REMINDER_SETTINGS;
	return {
		enabled: row.enabled,
		quiet: { from: row.quietFrom, until: row.quietUntil },
		lastSentAt: row.lastSentAt
	};
}

/**
 * Save the terms. A row is written the first time anybody touches the screen,
 * so "no row" only ever means "never asked".
 */
export async function writeReminderSettings(
	userId: string,
	patch: { enabled: boolean; quiet: QuietHours }
): Promise<void> {
	const now = new Date();
	await db
		.insert(reminderSettings)
		.values({
			userId,
			enabled: patch.enabled,
			quietFrom: patch.quiet.from,
			quietUntil: patch.quiet.until,
			lastSentAt: null,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: reminderSettings.userId,
			set: {
				enabled: patch.enabled,
				quietFrom: patch.quiet.from,
				quietUntil: patch.quiet.until,
				updatedAt: now
			}
		});
}

/** Spend this account's reminder for the day. */
export async function markReminded(userId: string, now: Date): Promise<void> {
	await db
		.update(reminderSettings)
		.set({ lastSentAt: now })
		.where(eq(reminderSettings.userId, userId));
}

/** Note that a device took delivery, so the settings list can say when. */
export async function markDelivered(endpoints: readonly string[], now: Date): Promise<void> {
	if (endpoints.length === 0) return;
	await db
		.update(pushSubscriptions)
		.set({ lastSentAt: now })
		.where(inArray(pushSubscriptions.endpoint, [...endpoints]));
}

/** One account the sweep has to make a decision about. */
export interface ReminderTarget {
	user: SessionUser;
	settings: ReminderSettings;
	devices: PushSubscriptionRow[];
}

function toSessionUser(row: UserRow): SessionUser {
	return {
		id: row.id,
		email: row.email,
		displayName: row.displayName,
		timeZone: row.timeZone,
		weekStartsOn: row.weekStartsOn,
		preferences: readPreferences(row.preferences)
	};
}

/**
 * Everyone the sweep might have something to say to: reminders on, and at least
 * one device listening.
 *
 * Loaded in two queries rather than per user, and deliberately not filtered by
 * quiet hours or by the daily cap — those are decided in `$domain/reminders`
 * against each account's own zone, which SQLite has nothing to say about.
 */
export async function listReminderTargets(): Promise<ReminderTarget[]> {
	const rows = await db
		.select({ user: users, settings: reminderSettings })
		.from(reminderSettings)
		.innerJoin(users, eq(reminderSettings.userId, users.id))
		.where(eq(reminderSettings.enabled, true));
	if (rows.length === 0) return [];

	const devices = await db
		.select()
		.from(pushSubscriptions)
		.where(
			inArray(
				pushSubscriptions.userId,
				rows.map((row) => row.user.id)
			)
		);

	const byUser = new Map<string, PushSubscriptionRow[]>();
	for (const device of devices) {
		const bucket = byUser.get(device.userId);
		if (bucket) bucket.push(device);
		else byUser.set(device.userId, [device]);
	}

	return rows
		.map((row) => ({
			user: toSessionUser(row.user),
			settings: {
				enabled: row.settings.enabled,
				quiet: { from: row.settings.quietFrom, until: row.settings.quietUntil },
				lastSentAt: row.settings.lastSentAt
			},
			devices: byUser.get(row.user.id) ?? []
		}))
		.filter((target) => target.devices.length > 0);
}
