import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';

/** Timestamps are stored as epoch milliseconds so they survive any time zone. */
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		passwordHash: text('password_hash').notNull(),
		displayName: text('display_name').notNull(),
		timeZone: text('time_zone').notNull().default('UTC'),
		/** 0 = Sunday … 6 = Saturday. */
		weekStartsOn: integer('week_starts_on').notNull().default(1),
		/**
		 * How the app is drawn for this account, as one JSON object — see
		 * `$domain/preferences`. A blob rather than a column per setting so
		 * adding the next preference is not another migration; null for rows
		 * that predate it, which `readPreferences()` reads as the defaults.
		 */
		preferences: text('preferences'),
		createdAt: timestamp('created_at').notNull()
	},
	(table) => [uniqueIndex('users_email_unique').on(table.email)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		/** SHA-256 of the token handed to the browser — the raw token is never stored. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull(),
		/**
		 * What the browser called itself when the session was created, so the
		 * session list can say which device a row belongs to. Null for sessions
		 * that predate the column, and for clients that send no user agent.
		 */
		userAgent: text('user_agent'),
		/** Refreshed lazily as the session is used; null until it is used again. */
		lastSeenAt: timestamp('last_seen_at')
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
);

/**
 * One row per password reset in flight.
 *
 * The same shape as `sessions`, and for the same reason: the mailbox holds a
 * random token, the database holds only its SHA-256, so a leaked database
 * cannot be used to reset anybody's password. Single use — `usedAt` is stamped
 * the moment a token is spent, and a spent or expired row is as good as gone.
 */
export const passwordResetTokens = sqliteTable(
	'password_reset_tokens',
	{
		/** SHA-256 of the token that went out in the email. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: timestamp('created_at').notNull(),
		/** Null until the token is spent; set once, never cleared. */
		usedAt: timestamp('used_at')
	},
	(table) => [index('password_reset_tokens_user_idx').on(table.userId)]
);

export const goals = sqliteTable(
	'goals',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		description: text('description'),
		/** One of the Tier ids: satellite | planet | starSystem | galaxy | universe. */
		tier: text('tier').notNull(),
		/** One of the MetricKind values: count | duration | checkin. */
		metricKind: text('metric_kind').notNull(),
		metricUnit: text('metric_unit').notNull().default(''),
		target: real('target').notNull(),
		color: text('color').notNull(),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at').notNull(),
		archivedAt: timestamp('archived_at'),
		/**
		 * The goal this one feeds, in a strictly longer tier — see
		 * `$domain/nesting`. Null for a goal that stands alone, which is every
		 * goal that existed before nesting did.
		 *
		 * `set null` rather than `cascade`: deleting a Star System must not take
		 * the weekly habits under it with it. The children are orphaned and carry
		 * on exactly as they were, which is also what makes deleting a parent a
		 * recoverable mistake.
		 *
		 * The same-user, longer-cadence and acyclic rules are enforced at write
		 * time in `$domain/nesting`, not here: SQLite can hold the reference but
		 * has nothing to say about any of the three.
		 */
		parentId: text('parent_id').references((): AnySQLiteColumn => goals.id, {
			onDelete: 'set null'
		})
	},
	(table) => [
		index('goals_user_id_idx').on(table.userId),
		index('goals_parent_id_idx').on(table.parentId)
	]
);

/**
 * One dormant span per archive/restore cycle.
 *
 * `goals.archivedAt` says whether a goal is archived right now; this says when
 * it was asleep, which is what the streak maths needs. Orbits that fall wholly
 * inside a window neither close nor break a streak, so restoring a goal picks
 * up where archiving left off however many times it has been round the loop.
 */
export const goalArchiveWindows = sqliteTable(
	'goal_archive_windows',
	{
		id: text('id').primaryKey(),
		goalId: text('goal_id')
			.notNull()
			.references(() => goals.id, { onDelete: 'cascade' }),
		archivedAt: timestamp('archived_at').notNull(),
		/** Null while the goal is still archived. */
		restoredAt: timestamp('restored_at')
	},
	(table) => [index('goal_archive_windows_goal_idx').on(table.goalId)]
);

export const entries = sqliteTable(
	'entries',
	{
		id: text('id').primaryKey(),
		goalId: text('goal_id')
			.notNull()
			.references(() => goals.id, { onDelete: 'cascade' }),
		amount: real('amount').notNull(),
		note: text('note'),
		/** When the work happened, which is not always when it was logged. */
		occurredAt: timestamp('occurred_at').notNull(),
		createdAt: timestamp('created_at').notNull(),
		/**
		 * The id the browser gave this entry before it was ever sent — see
		 * `$lib/offline/queue`. An entry logged offline is retried until it lands,
		 * and a retry after a partial failure has no way of knowing whether the
		 * first attempt was written, so the insert conflicts on this instead of
		 * reading first and racing itself. Null for anything logged before the
		 * queue existed, and for a server-side insert with nothing to be idempotent
		 * about; SQLite counts each null as distinct, so those never collide.
		 */
		clientId: text('client_id')
	},
	(table) => [
		index('entries_goal_occurred_idx').on(table.goalId, table.occurredAt),
		/*
		 * Scoped to the goal rather than global: the insert has already checked
		 * that this user owns this goal, so a client id guessed or replayed from
		 * somewhere else cannot silently swallow an entry that belongs to another
		 * account's goal.
		 */
		uniqueIndex('entries_goal_client_unique').on(table.goalId, table.clientId)
	]
);

/**
 * One row per device that has agreed to be reminded.
 *
 * Per device rather than per account, because that is what a push subscription
 * is: the browser mints one against its own push service and the same person
 * signing in on a phone and a laptop has two. The endpoint is the address the
 * push service routes on, and the two keys are what the payload is encrypted
 * to — see `$lib/server/push`.
 *
 * The endpoint is unique across the table, not per user. A push service hands
 * the same endpoint back to whoever is using that browser profile, so a shared
 * device that signs in as somebody else must move the row rather than end up
 * with two accounts pushing to one address.
 *
 * Nothing here is a secret Nova chose: the keys belong to the browser, and a
 * subscription that stops working is deleted rather than retried, because a
 * 404 or a 410 from the push service means the device is gone for good.
 */
export const pushSubscriptions = sqliteTable(
	'push_subscriptions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Where the push service takes delivery, and the identity of the device. */
		endpoint: text('endpoint').notNull(),
		/** The device's public key, base64url, exactly as the browser gave it. */
		p256dh: text('p256dh').notNull(),
		/** The device's auth secret, base64url. */
		auth: text('auth').notNull(),
		/** What the browser called itself, so the settings list can name the device. */
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at').notNull(),
		/** Null until this device has been sent something. */
		lastSentAt: timestamp('last_sent_at')
	},
	(table) => [
		uniqueIndex('push_subscriptions_endpoint_unique').on(table.endpoint),
		index('push_subscriptions_user_idx').on(table.userId)
	]
);

/**
 * When an account is willing to be interrupted, one row per user.
 *
 * A row exists only once somebody has opened the reminders screen; its absence
 * reads as the defaults, which are off. Quiet hours are stored as minutes past
 * local midnight rather than as instants because that is what they mean — ten
 * at night where the person is, whatever the server's zone. `$domain/reminders`
 * resolves them against the account's own zone.
 *
 * `lastSentAt` is the whole of the frequency cap: one reminder per user per
 * local day, counted from here.
 */
export const reminderSettings = sqliteTable('reminder_settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
	/** Inclusive start of the quiet window, minutes past local midnight. */
	quietFrom: integer('quiet_from')
		.notNull()
		.default(22 * 60),
	/** Exclusive end. Smaller than `quiet_from` when the window crosses midnight. */
	quietUntil: integer('quiet_until')
		.notNull()
		.default(7 * 60),
	/** When this account was last reminded, in any device. Null until the first. */
	lastSentAt: timestamp('last_sent_at'),
	updatedAt: timestamp('updated_at').notNull()
});

export type UserRow = typeof users.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type EntryRow = typeof entries.$inferSelect;
export type GoalArchiveWindowRow = typeof goalArchiveWindows.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type ReminderSettingsRow = typeof reminderSettings.$inferSelect;
