import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
		createdAt: timestamp('created_at').notNull()
	},
	(table) => [index('sessions_user_id_idx').on(table.userId)]
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
		archivedAt: timestamp('archived_at')
	},
	(table) => [index('goals_user_id_idx').on(table.userId)]
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
		createdAt: timestamp('created_at').notNull()
	},
	(table) => [index('entries_goal_occurred_idx').on(table.goalId, table.occurredAt)]
);

export type UserRow = typeof users.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type EntryRow = typeof entries.$inferSelect;
export type GoalArchiveWindowRow = typeof goalArchiveWindows.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
