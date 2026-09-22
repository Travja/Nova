import { z } from 'zod';
import { parentProblem, PARENT_PROBLEM_MESSAGE, type ParentCandidate } from './nesting';
import { isPaletteColor } from './palette';
import { TIERS, type Tier } from './tiers';
import type { MetricKind } from './types';

/**
 * The transfer bundle: what an export is, and what an import is allowed to be.
 *
 * Everything here is pure data — no database, no SvelteKit — for the usual
 * reason and one extra. The usual one is that the id remapping and the drop
 * rules are the risky half of importing and they deserve tests that run in
 * milliseconds. The extra one is that the same schema describes a file the
 * browser is holding but has not uploaded yet, so a bad file can be named as
 * bad before it is ever sent.
 *
 * ## The file is an allowlist
 *
 * Every field that ships is named below, once. `users.passwordHash`,
 * `sessions`, `passwordResetTokens`, `pushSubscriptions` and
 * `reminderSettings.lastSentAt` are absent, and the point of naming the
 * included columns rather than excluding those is that the next column added
 * to `users` is absent by default rather than present by accident — an export
 * is a plaintext file that lands in a Downloads folder and is often mailed
 * onwards "to keep safe".
 *
 * `bundleSchema` is the enforcement as well as the declaration: Zod strips
 * what it does not know, so a row that somehow picks up a credential on the
 * way out loses it again before it is serialised. `transfer.test.ts` asserts
 * the key set of each table against a written-out list, so widening the
 * allowlist has to be deliberate.
 *
 * ## Ids are remapped, always
 *
 * `planImport()` mints a new id for every row and rewrites every reference.
 * Reusing the file's own ids would collide the moment somebody imports into an
 * account that already has rows, and reusing them *selectively* — keeping the
 * id when the account happens to own it — would let a file's claim about a
 * goal's tier reach an edge pointing at a real goal with a different one. So
 * every written goal's parent is another goal from the same file, which makes
 * the bundle's own graph the whole of what has to be checked.
 *
 * Minting is deterministic (see `MintId`), which is what makes a second import
 * of the same file a no-op rather than a second copy.
 */

/** The envelope's version. Bumped when the shape below stops being readable as it is. */
export const TRANSFER_SCHEMA_VERSION = 1;

/**
 * How large an import may be, checked before anything is parsed.
 *
 * `JSON.parse` on an arbitrarily large body is a denial of service with extra
 * steps, and this arrives shaped like unauthenticated input even though a
 * session is required to send it.
 *
 * The number comes from the heaviest table. An entry serialises to roughly 200
 * bytes — two ids, two timestamps, an amount and usually a null note — so 16 MB
 * holds on the order of 80,000 of them. That is ten logs every day for more
 * than twenty years, with the goals, asteroids and notes around them costing a
 * rounding error by comparison. Anything past it is not a personal record.
 */
export const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

/** The cap as the error message says it, so the two cannot drift. */
export const MAX_BUNDLE_LABEL = '16 MB';

/**
 * Row ids are bounded and url-safe because they become primary keys, and
 * because an entry's minted `clientId` is derived from one.
 */
const rowId = z
	.string()
	.trim()
	.min(1, 'That row has no id.')
	.max(64, 'That id is too long.')
	.regex(/^[A-Za-z0-9_-]+$/, 'That id has characters Nova cannot store.');

/** Timestamps travel as UTC epoch milliseconds, the way they are stored. */
const epochMs = z
	.number()
	.int('Timestamps are whole milliseconds.')
	.min(-8.64e15, 'That timestamp is outside the range a date can hold.')
	.max(8.64e15, 'That timestamp is outside the range a date can hold.');

const nullableEpochMs = epochMs.nullable();

const optionalText = (max: number) => z.string().max(max).nullable();

/**
 * The profile, minus the credential and minus the id.
 *
 * `email` travels so a restored file can say whose it is, but importing never
 * writes it: an account's address is its identity and the file's may belong to
 * somebody else entirely.
 */
export const profileSchema = z.object({
	email: z.string().max(254),
	displayName: z.string().max(64),
	// Checked rather than stored blind: every period boundary in Nova is drawn
	// through `Intl` in this zone, so a zone no runtime recognises would not be
	// a bad field, it would be an account whose weeks cannot be computed.
	timeZone: z
		.string()
		.max(64)
		.refine((value) => {
			try {
				new Intl.DateTimeFormat('en-US', { timeZone: value });
				return true;
			} catch {
				return false;
			}
		}, 'That is not a time zone Nova recognises.'),
	weekStartsOn: z.number().int().min(0).max(6),
	/** The preference blob, already parsed. Unknown keys fall back on the way in. */
	preferences: z.record(z.string(), z.string()).nullable(),
	createdAt: epochMs
});

export const goalBundleSchema = z.object({
	id: rowId,
	title: z.string().max(80),
	description: optionalText(500),
	tier: z.enum(TIERS),
	metricKind: z.enum(['count', 'duration', 'checkin']),
	metricUnit: z.string().max(24),
	target: z.number().positive('The target has to be greater than zero.').max(1_000_000),
	// Strict, not coerced to a default: the colour reaches a CSS custom property,
	// so an arbitrary string from a file is not something to store and find out
	// about later.
	color: z.string().refine(isPaletteColor, 'That is not a colour Nova draws with.'),
	sortOrder: z.number().int().min(-1_000_000).max(1_000_000),
	createdAt: epochMs,
	archivedAt: nullableEpochMs,
	parentId: rowId.nullable()
});

export const archiveWindowBundleSchema = z.object({
	id: rowId,
	goalId: rowId,
	archivedAt: epochMs,
	restoredAt: nullableEpochMs
});

export const entryBundleSchema = z.object({
	id: rowId,
	goalId: rowId,
	amount: z
		.number()
		.refine((value) => Number.isFinite(value), 'That amount is not a number.')
		.refine((value) => Math.abs(value) <= 1_000_000, 'That amount is suspiciously large.'),
	note: optionalText(200),
	occurredAt: epochMs,
	createdAt: epochMs,
	clientId: rowId.nullable()
});

export const asteroidBundleSchema = z
	.object({
		id: rowId,
		title: z.string().max(80),
		note: optionalText(500),
		createdAt: epochMs,
		driftAnchorAt: epochMs,
		resolution: z.enum(['cleared', 'captured', 'released']).nullable(),
		resolvedAt: nullableEpochMs,
		capturedGoalId: rowId.nullable(),
		captureDismissedAt: nullableEpochMs
	})
	.superRefine((rock, ctx) => {
		// `resolution` is the discriminator the table is built around, so a file
		// disagreeing with itself about whether a rock is off the belt is a bad
		// row rather than something to normalise quietly.
		if (rock.resolution === null && rock.resolvedAt !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['resolvedAt'],
				message: 'An asteroid still on the belt cannot have been resolved.'
			});
		}
		if (rock.resolution !== null && rock.resolvedAt === null) {
			ctx.addIssue({
				code: 'custom',
				path: ['resolvedAt'],
				message: 'A resolved asteroid needs the moment it was resolved.'
			});
		}
		if (rock.capturedGoalId !== null && rock.resolution !== 'captured') {
			ctx.addIssue({
				code: 'custom',
				path: ['capturedGoalId'],
				message: 'Only a captured asteroid points at a goal.'
			});
		}
	});

export const orbitNoteBundleSchema = z.object({
	id: rowId,
	goalId: rowId,
	/**
	 * The key the note was written against, never one recomputed here: the
	 * importing account may start its weeks on a different day, and rewriting
	 * the key would reassign a note to a period it was never about. Same
	 * reasoning as #18's decision 2, which is also why `periodStart` travels.
	 */
	periodKey: z.string().min(1).max(80),
	periodStart: epochMs,
	body: z.string().max(2000),
	createdAt: epochMs,
	updatedAt: epochMs
});

export const reminderSettingsBundleSchema = z.object({
	enabled: z.boolean(),
	quietFrom: z
		.number()
		.int()
		.min(0)
		.max(24 * 60),
	quietUntil: z
		.number()
		.int()
		.min(0)
		.max(24 * 60),
	updatedAt: epochMs
	// `lastSentAt` is deliberately absent: server bookkeeping for the one
	// reminder a day cap, not the pilot's record.
});

/**
 * Ids have to be unique within their own table — they are about to become keys,
 * and the old-to-new map an import keeps would quietly lose one of a pair.
 */
const uniqueList = <T extends z.ZodType<{ id: string }>>(row: T) =>
	z.array(row).superRefine((rows, ctx) => {
		const seen = new Set<string>();
		rows.forEach((entry, index) => {
			if (seen.has(entry.id)) {
				ctx.addIssue({
					code: 'custom',
					path: [index, 'id'],
					message: 'Two rows in this file share an id.'
				});
			}
			seen.add(entry.id);
		});
	});

export const bundleSchema = z.object({
	schemaVersion: z.number().int(),
	exportedAt: epochMs,
	profile: profileSchema,
	goals: uniqueList(goalBundleSchema),
	goalArchiveWindows: uniqueList(archiveWindowBundleSchema),
	entries: uniqueList(entryBundleSchema),
	asteroids: uniqueList(asteroidBundleSchema),
	orbitNotes: uniqueList(orbitNoteBundleSchema),
	reminderSettings: reminderSettingsBundleSchema.nullable()
});

export type Bundle = z.infer<typeof bundleSchema>;
export type BundleGoal = z.infer<typeof goalBundleSchema>;
export type BundleEntry = z.infer<typeof entryBundleSchema>;
export type BundleAsteroid = z.infer<typeof asteroidBundleSchema>;
export type BundleArchiveWindow = z.infer<typeof archiveWindowBundleSchema>;
export type BundleOrbitNote = z.infer<typeof orbitNoteBundleSchema>;
export type BundleReminderSettings = z.infer<typeof reminderSettingsBundleSchema>;

/* -------------------------------------------------------------------------- */
/* Reading a file                                                              */
/* -------------------------------------------------------------------------- */

export type ImportProblem =
	| { kind: 'size'; characters: number }
	| { kind: 'json' }
	| { kind: 'version'; found: unknown }
	| { kind: 'schema'; issues: string[] }
	| { kind: 'nesting'; row: string; message: string };

/** `goals[3].color`, so a message can say which row rather than which field. */
function pathLabel(path: readonly PropertyKey[]): string {
	return path.reduce<string>((label, part) => {
		if (typeof part === 'number') return `${label}[${part}]`;
		return label ? `${label}.${String(part)}` : String(part);
	}, '');
}

/** How many issues a message lists before it stops; the rest are counted. */
const ISSUES_SHOWN = 5;

export function importProblemMessage(problem: ImportProblem): string {
	switch (problem.kind) {
		case 'size':
			return `That file is bigger than ${MAX_BUNDLE_LABEL}, which is more than an export can be.`;
		case 'json':
			return 'That file is not JSON Nova can read.';
		case 'version':
			return typeof problem.found === 'number' && problem.found > TRANSFER_SCHEMA_VERSION
				? `That file was written by a newer Nova (format ${problem.found}); this one reads format ${TRANSFER_SCHEMA_VERSION}. Update Nova and try again.`
				: `That file is not a Nova export of format ${TRANSFER_SCHEMA_VERSION}.`;
		case 'schema': {
			const shown = problem.issues.slice(0, ISSUES_SHOWN).join(' ');
			const rest = problem.issues.length - ISSUES_SHOWN;
			return rest > 0
				? `Nothing was imported. ${shown} …and ${rest} more.`
				: `Nothing was imported. ${shown}`;
		}
		case 'nesting':
			return `Nothing was imported. ${problem.row}: ${problem.message}`;
	}
}

export type BundleRead = { ok: true; bundle: Bundle } | { ok: false; problem: ImportProblem };

/**
 * Size, then JSON, then version, then the whole shape — in that order, because
 * each step is only safe once the one before it has passed.
 *
 * The length checked here is UTF-16 code units rather than bytes, which is the
 * one measurement available without walking the string again; the route checks
 * the uploaded file's real byte length before it ever gets this far. Both are
 * bounded by the same number, and a cap that is generous by a factor of two on
 * astral text is still a cap.
 */
export function readBundle(source: string): BundleRead {
	if (source.length > MAX_BUNDLE_BYTES) {
		return { ok: false, problem: { kind: 'size', characters: source.length } };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		return { ok: false, problem: { kind: 'json' } };
	}

	// The version gate comes before validation so a newer file is refused for
	// what it is rather than reported as a hundred unknown fields — and so a
	// file this build does not understand is never half-read.
	const version =
		typeof parsed === 'object' && parsed !== null
			? (parsed as Record<string, unknown>).schemaVersion
			: undefined;
	if (version !== TRANSFER_SCHEMA_VERSION) {
		return { ok: false, problem: { kind: 'version', found: version } };
	}

	const result = bundleSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map(
			(issue) => `${pathLabel(issue.path) || 'file'}: ${issue.message}`
		);
		return { ok: false, problem: { kind: 'schema', issues } };
	}

	return { ok: true, bundle: result.data };
}

/* -------------------------------------------------------------------------- */
/* Planning a write                                                            */
/* -------------------------------------------------------------------------- */

export type ImportMode = 'merge' | 'replace';

/**
 * A new id for one row of one table.
 *
 * Deterministic per account, which is the whole of the idempotency guarantee:
 * importing the same file twice mints the same ids the second time, so every
 * row collides with the one already written and nothing is added. The server
 * derives it from the account id and the bundle's own row id; a test can pass
 * anything stable.
 */
export type MintId = (table: TransferTable, bundleId: string) => string;

export const TRANSFER_TABLES = [
	'goals',
	'goalArchiveWindows',
	'entries',
	'asteroids',
	'orbitNotes'
] as const;

export type TransferTable = (typeof TRANSFER_TABLES)[number];

export const TRANSFER_TABLE_LABEL: Record<TransferTable, string> = {
	goals: 'Goals',
	goalArchiveWindows: 'Archive windows',
	entries: 'Entries',
	asteroids: 'Asteroids',
	orbitNotes: 'Orbit notes'
};

/** What the account already holds — enough to say what a write would change. */
export interface AccountShape {
	/** Ids of goals this account owns, archived ones included. */
	goalIds: ReadonlySet<string>;
	archiveWindowIds: ReadonlySet<string>;
	/** `entryKey(goalId, clientId)` for every entry with a client id. */
	entryKeys: ReadonlySet<string>;
	asteroidIds: ReadonlySet<string>;
	/** `noteKey(goalId, periodKey)`, the pair the table is unique on. */
	noteKeys: ReadonlySet<string>;
	hasReminderSettings: boolean;
	/** The highest `sortOrder` in use, so imported goals land after what is here. */
	highestSortOrder: number;
	/** How many rows replace would delete, per table. */
	counts: Record<TransferTable, number>;
}

/** The empty account, which is also what replace imports into. */
export const EMPTY_ACCOUNT: AccountShape = {
	goalIds: new Set(),
	archiveWindowIds: new Set(),
	entryKeys: new Set(),
	asteroidIds: new Set(),
	noteKeys: new Set(),
	hasReminderSettings: false,
	highestSortOrder: -1,
	counts: { goals: 0, goalArchiveWindows: 0, entries: 0, asteroids: 0, orbitNotes: 0 }
};

export function entryKey(goalId: string, clientId: string): string {
	return `${goalId}\u0000${clientId}`;
}

export function noteKey(goalId: string, periodKey: string): string {
	return `${goalId}\u0000${periodKey}`;
}

/**
 * The client id an entry that never had one is given on the way in.
 *
 * SQLite counts every null as distinct, so `(goalId, null)` dedupes against
 * nothing and an entry logged before the offline queue existed would land
 * again on every merge. Deriving one from the bundle's own row id makes the
 * pair stable across imports of the same file, which is what makes a repeat
 * merge a no-op for *every* entry rather than most of them.
 */
export function importedClientId(bundleEntryId: string): string {
	return `imported-${bundleEntryId}`;
}

export interface PlannedGoal {
	id: string;
	title: string;
	description: string | null;
	tier: Tier;
	metricKind: MetricKind;
	metricUnit: string;
	target: number;
	color: string;
	sortOrder: number;
	createdAt: Date;
	archivedAt: Date | null;
	parentId: string | null;
}

export interface PlannedArchiveWindow {
	id: string;
	goalId: string;
	archivedAt: Date;
	restoredAt: Date | null;
}

export interface PlannedEntry {
	id: string;
	goalId: string;
	amount: number;
	note: string | null;
	occurredAt: Date;
	createdAt: Date;
	clientId: string;
}

export interface PlannedAsteroid {
	id: string;
	title: string;
	note: string | null;
	createdAt: Date;
	driftAnchorAt: Date;
	resolution: 'cleared' | 'captured' | 'released' | null;
	resolvedAt: Date | null;
	capturedGoalId: string | null;
	captureDismissedAt: Date | null;
}

export interface PlannedOrbitNote {
	id: string;
	goalId: string;
	periodKey: string;
	periodStart: Date;
	body: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface PlannedReminderSettings {
	enabled: boolean;
	quietFrom: number;
	quietUntil: number;
	updatedAt: Date;
}

/** What the profile does, which on a merge is nothing. */
export interface PlannedProfile {
	displayName: string;
	timeZone: string;
	weekStartsOn: number;
	preferences: Record<string, string> | null;
}

export interface TableSummary {
	/** Rows of this table in the file. */
	inFile: number;
	/** Rows this import would write. */
	added: number;
	/** Rows the account already has, so the write leaves them alone. */
	duplicate: number;
	/** Rows dropped because the goal they hang off is not in the file. */
	orphaned: number;
	/** Rows replace would delete first. */
	deleted: number;
}

export interface ImportSummary {
	mode: ImportMode;
	tables: Record<TransferTable, TableSummary>;
	reminderSettings: { inFile: boolean; written: boolean; deleted: boolean };
	/** True when the import restores the file's display name, zone and week start. */
	profileRestored: boolean;
}

export interface ImportPlan {
	mode: ImportMode;
	/** Rows to insert, already remapped. Goals come parents-first. */
	goals: PlannedGoal[];
	archiveWindows: PlannedArchiveWindow[];
	entries: PlannedEntry[];
	asteroids: PlannedAsteroid[];
	orbitNotes: PlannedOrbitNote[];
	reminderSettings: PlannedReminderSettings | null;
	profile: PlannedProfile | null;
	/** True when the write clears the account's own rows first. */
	wipeFirst: boolean;
	summary: ImportSummary;
}

export type ImportPlanResult =
	{ ok: true; plan: ImportPlan } | { ok: false; problem: ImportProblem };

function emptySummary(inFile: number, deleted: number): TableSummary {
	return { inFile, added: 0, duplicate: 0, orphaned: 0, deleted };
}

/**
 * What a write would do, without doing it.
 *
 * The dry run and the write are the same call: the route plans, renders the
 * summary, and — on the confirming post — plans again from the same validated
 * bundle and applies what comes back. A summary produced by a second
 * implementation would be describing a program nobody is about to run.
 *
 * Merge adds and never edits: a row whose minted id the account already holds
 * is counted as a duplicate and left out of the write entirely, which is also
 * why the `onConflictDoNothing` in the writer is a backstop against a
 * concurrent insert rather than the mechanism.
 */
export function planImport(
	bundle: Bundle,
	account: AccountShape,
	options: { mode: ImportMode; mintId: MintId }
): ImportPlanResult {
	const { mode, mintId } = options;
	const replacing = mode === 'replace';
	// Replace clears the account's own rows first and then imports as if into an
	// empty account, so everything below plans against nothing already there.
	const target = replacing ? EMPTY_ACCOUNT : account;
	const sortOrderOffset = replacing ? 0 : account.highestSortOrder + 1;

	const summary: ImportSummary = {
		mode,
		tables: {
			goals: emptySummary(bundle.goals.length, replacing ? account.counts.goals : 0),
			goalArchiveWindows: emptySummary(
				bundle.goalArchiveWindows.length,
				replacing ? account.counts.goalArchiveWindows : 0
			),
			entries: emptySummary(bundle.entries.length, replacing ? account.counts.entries : 0),
			asteroids: emptySummary(bundle.asteroids.length, replacing ? account.counts.asteroids : 0),
			orbitNotes: emptySummary(bundle.orbitNotes.length, replacing ? account.counts.orbitNotes : 0)
		},
		reminderSettings: {
			inFile: bundle.reminderSettings !== null,
			written: false,
			deleted: replacing && account.hasReminderSettings
		},
		profileRestored: replacing
	};

	/** Every goal in the file, old id to the id it will be written under. */
	const goalIds = new Map<string, string>();
	for (const goal of bundle.goals) goalIds.set(goal.id, mintId('goals', goal.id));

	const goals: PlannedGoal[] = bundle.goals.map((goal) => ({
		id: goalIds.get(goal.id) as string,
		title: goal.title,
		description: goal.description,
		tier: goal.tier,
		metricKind: goal.metricKind,
		metricUnit: goal.metricUnit,
		target: goal.target,
		color: goal.color,
		sortOrder: goal.sortOrder + sortOrderOffset,
		createdAt: new Date(goal.createdAt),
		archivedAt: goal.archivedAt === null ? null : new Date(goal.archivedAt),
		// A parent that is not in the file is dropped rather than invented,
		// exactly as `$domain/nesting` tolerates a goal that stands alone.
		parentId: goal.parentId === null ? null : (goalIds.get(goal.parentId) ?? null)
	}));

	// Same user, strictly longer cadence, acyclic. None of the three is a thing
	// SQLite can hold an opinion about — they are enforced at write time, here
	// and in `createGoal()` — so a file claiming to be an export is checked
	// rather than believed. Every written goal's parent is another goal from
	// this same file, so the file's own graph is the whole of what to check.
	const candidates: ParentCandidate[] = goals.map((goal) => ({
		id: goal.id,
		title: goal.title,
		tier: goal.tier,
		parentId: goal.parentId,
		archivedAt: goal.archivedAt
	}));
	for (const [index, goal] of goals.entries()) {
		const problem = parentProblem(goal, goal.parentId, candidates);
		if (problem) {
			return {
				ok: false,
				problem: {
					kind: 'nesting',
					row: `goals[${index}] "${bundle.goals[index].title}"`,
					message: PARENT_PROBLEM_MESSAGE[problem]
				}
			};
		}
	}

	const writtenGoalIds = new Set<string>();
	const goalWrites: PlannedGoal[] = [];
	for (const goal of goals) {
		if (target.goalIds.has(goal.id)) {
			summary.tables.goals.duplicate += 1;
			// The goal is already here, so rows hanging off it still land on it.
			writtenGoalIds.add(goal.id);
			continue;
		}
		goalWrites.push(goal);
		writtenGoalIds.add(goal.id);
	}
	summary.tables.goals.added = goalWrites.length;

	/** Where a row hanging off a goal lands, or null when its goal is not here. */
	const goalFor = (bundleGoalId: string): string | null => {
		const id = goalIds.get(bundleGoalId);
		return id && writtenGoalIds.has(id) ? id : null;
	};

	const archiveWindows: PlannedArchiveWindow[] = [];
	for (const window of bundle.goalArchiveWindows) {
		const goalId = goalFor(window.goalId);
		if (!goalId) {
			summary.tables.goalArchiveWindows.orphaned += 1;
			continue;
		}
		const id = mintId('goalArchiveWindows', window.id);
		if (target.archiveWindowIds.has(id)) {
			summary.tables.goalArchiveWindows.duplicate += 1;
			continue;
		}
		archiveWindows.push({
			id,
			goalId,
			archivedAt: new Date(window.archivedAt),
			restoredAt: window.restoredAt === null ? null : new Date(window.restoredAt)
		});
	}
	summary.tables.goalArchiveWindows.added = archiveWindows.length;

	const entries: PlannedEntry[] = [];
	/** Pairs this plan has already claimed, so one file cannot collide with itself. */
	const claimedEntries = new Set<string>();
	for (const entry of bundle.entries) {
		const goalId = goalFor(entry.goalId);
		if (!goalId) {
			summary.tables.entries.orphaned += 1;
			continue;
		}
		const clientId = entry.clientId ?? importedClientId(entry.id);
		const key = entryKey(goalId, clientId);
		if (target.entryKeys.has(key) || claimedEntries.has(key)) {
			summary.tables.entries.duplicate += 1;
			continue;
		}
		claimedEntries.add(key);
		entries.push({
			id: mintId('entries', entry.id),
			goalId,
			amount: entry.amount,
			note: entry.note,
			occurredAt: new Date(entry.occurredAt),
			createdAt: new Date(entry.createdAt),
			clientId
		});
	}
	summary.tables.entries.added = entries.length;

	const asteroids: PlannedAsteroid[] = [];
	for (const rock of bundle.asteroids) {
		const id = mintId('asteroids', rock.id);
		if (target.asteroidIds.has(id)) {
			summary.tables.asteroids.duplicate += 1;
			continue;
		}
		asteroids.push({
			id,
			title: rock.title,
			note: rock.note,
			createdAt: new Date(rock.createdAt),
			driftAnchorAt: new Date(rock.driftAnchorAt),
			resolution: rock.resolution,
			resolvedAt: rock.resolvedAt === null ? null : new Date(rock.resolvedAt),
			// The goal a rock became may not be in the file; the capture still
			// happened, so the link goes and the resolution stays — #30's rule.
			capturedGoalId: rock.capturedGoalId === null ? null : goalFor(rock.capturedGoalId),
			captureDismissedAt:
				rock.captureDismissedAt === null ? null : new Date(rock.captureDismissedAt)
		});
	}
	summary.tables.asteroids.added = asteroids.length;

	const orbitNotes: PlannedOrbitNote[] = [];
	const claimedNotes = new Set<string>();
	for (const note of bundle.orbitNotes) {
		const goalId = goalFor(note.goalId);
		if (!goalId) {
			summary.tables.orbitNotes.orphaned += 1;
			continue;
		}
		const key = noteKey(goalId, note.periodKey);
		if (target.noteKeys.has(key) || claimedNotes.has(key)) {
			summary.tables.orbitNotes.duplicate += 1;
			continue;
		}
		claimedNotes.add(key);
		orbitNotes.push({
			id: mintId('orbitNotes', note.id),
			goalId,
			periodKey: note.periodKey,
			periodStart: new Date(note.periodStart),
			body: note.body,
			createdAt: new Date(note.createdAt),
			updatedAt: new Date(note.updatedAt)
		});
	}
	summary.tables.orbitNotes.added = orbitNotes.length;

	// Reminder terms are one row per account, so merging into an account that
	// already has one would be editing it. Replace has already cleared it.
	const reminderSettings =
		bundle.reminderSettings && !target.hasReminderSettings
			? {
					enabled: bundle.reminderSettings.enabled,
					quietFrom: bundle.reminderSettings.quietFrom,
					quietUntil: bundle.reminderSettings.quietUntil,
					updatedAt: new Date(bundle.reminderSettings.updatedAt)
				}
			: null;
	summary.reminderSettings.written = reminderSettings !== null;

	/*
	 * Merge leaves the profile alone for the same reason it leaves every other
	 * existing row alone. Replace restores the name, the zone, the week start
	 * and the preferences, because a period boundary is drawn in the account's
	 * zone and a restored record whose weeks start on a different day is not the
	 * record that was exported. The email never moves either way: it is the
	 * account's identity, and the file's may belong to somebody else.
	 */
	const profile: PlannedProfile | null = replacing
		? {
				displayName: bundle.profile.displayName,
				timeZone: bundle.profile.timeZone,
				weekStartsOn: bundle.profile.weekStartsOn,
				preferences: bundle.profile.preferences
			}
		: null;

	return {
		ok: true,
		plan: {
			mode,
			goals: parentsFirst(goalWrites),
			archiveWindows,
			entries,
			asteroids,
			orbitNotes,
			reminderSettings,
			profile,
			wipeFirst: replacing,
			summary
		}
	};
}

/**
 * Goals in an order a foreign key will accept: a parent is always inserted
 * before the child that points at it.
 *
 * `parentProblem()` has already refused a cycle, so the walk terminates. A
 * parent that is not among these goals is one the plan already rewrote to
 * null, so there is nothing left to wait for.
 */
function parentsFirst(goals: readonly PlannedGoal[]): PlannedGoal[] {
	const byId = new Map(goals.map((goal) => [goal.id, goal]));
	const ordered: PlannedGoal[] = [];
	const placed = new Set<string>();

	const place = (goal: PlannedGoal) => {
		if (placed.has(goal.id)) return;
		placed.add(goal.id);
		const parent = goal.parentId ? byId.get(goal.parentId) : undefined;
		if (parent) place(parent);
		ordered.push(goal);
	};

	for (const goal of goals) place(goal);
	return ordered;
}

/** Whether a plan would write anything at all — what the confirm button asks. */
export function planIsEmpty(plan: ImportPlan): boolean {
	return (
		!plan.wipeFirst &&
		plan.goals.length === 0 &&
		plan.archiveWindows.length === 0 &&
		plan.entries.length === 0 &&
		plan.asteroids.length === 0 &&
		plan.orbitNotes.length === 0 &&
		plan.reminderSettings === null
	);
}
