import { describe, expect, it } from 'vitest';
import {
	archiveWindowBundleSchema,
	asteroidBundleSchema,
	bundleSchema,
	entryBundleSchema,
	entryKey,
	goalBundleSchema,
	importedClientId,
	importProblemMessage,
	MAX_BUNDLE_BYTES,
	noteKey,
	orbitNoteBundleSchema,
	planImport,
	readBundle,
	TRANSFER_SCHEMA_VERSION,
	EMPTY_ACCOUNT,
	type AccountShape,
	type Bundle,
	type ImportMode,
	type ImportPlan
} from './transfer';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 5);

function bundle(patch: Partial<Bundle> = {}): Bundle {
	return {
		schemaVersion: TRANSFER_SCHEMA_VERSION,
		exportedAt: T0,
		goals: [],
		goalArchiveWindows: [],
		entries: [],
		asteroids: [],
		orbitNotes: [],
		...patch
	};
}

function goal(patch: Partial<Bundle['goals'][number]> = {}): Bundle['goals'][number] {
	return {
		id: 'goal-1',
		title: 'Read',
		description: null,
		tier: 'planet',
		metricKind: 'count',
		metricUnit: 'pages',
		target: 100,
		color: '#a78bfa',
		sortOrder: 0,
		createdAt: T0 - 100 * DAY,
		archivedAt: null,
		parentId: null,
		...patch
	};
}

function entry(patch: Partial<Bundle['entries'][number]> = {}): Bundle['entries'][number] {
	return {
		id: 'entry-1',
		goalId: 'goal-1',
		amount: 10,
		note: null,
		occurredAt: T0 - 3 * DAY,
		createdAt: T0 - 3 * DAY,
		clientId: null,
		...patch
	};
}

function asteroid(patch: Partial<Bundle['asteroids'][number]> = {}): Bundle['asteroids'][number] {
	return {
		id: 'rock-1',
		title: 'Fix the shed',
		note: null,
		createdAt: T0 - 50 * DAY,
		driftAnchorAt: T0 - 50 * DAY,
		resolution: null,
		resolvedAt: null,
		capturedGoalId: null,
		captureDismissedAt: null,
		...patch
	};
}

/** Ids a test can read: the table and the file's own id, joined. */
const mintId = (table: string, id: string) => `new-${table}-${id}`;

function plan(source: Bundle, account: AccountShape = EMPTY_ACCOUNT, mode: ImportMode = 'merge') {
	const result = planImport(source, account, { mode, mintId });
	if (!result.ok) throw new Error(`planning failed: ${importProblemMessage(result.problem)}`);
	return result.plan;
}

/** The account a plan leaves behind, so a second import can be planned against it. */
function accountAfter(applied: ImportPlan): AccountShape {
	return {
		goalIds: new Set(applied.goals.map((row) => row.id)),
		archiveWindowIds: new Set(applied.archiveWindows.map((row) => row.id)),
		entryKeys: new Set(applied.entries.map((row) => entryKey(row.goalId, row.clientId))),
		asteroidIds: new Set(applied.asteroids.map((row) => row.id)),
		noteKeys: new Set(applied.orbitNotes.map((row) => noteKey(row.goalId, row.periodKey))),
		highestSortOrder: applied.goals.reduce((high, row) => Math.max(high, row.sortOrder), -1),
		counts: {
			goals: applied.goals.length,
			goalArchiveWindows: applied.archiveWindows.length,
			entries: applied.entries.length,
			asteroids: applied.asteroids.length,
			orbitNotes: applied.orbitNotes.length
		}
	};
}

/* -------------------------------------------------------------------------- */
/* The allowlist                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The file is an allowlist, and this is the list.
 *
 * Adding a column to `goals`, `entries` or any other table cannot widen the
 * export without also widening `$domain/transfer` — and widening that fails
 * here, which is the point. The failure is the prompt to ask whether the new
 * column belongs in a plaintext file that lands in a Downloads folder.
 */
describe('the exported shape', () => {
	const expected: Record<string, string[]> = {
		goals: [
			'id',
			'title',
			'description',
			'tier',
			'metricKind',
			'metricUnit',
			'target',
			'color',
			'sortOrder',
			'createdAt',
			'archivedAt',
			'parentId'
		],
		goalArchiveWindows: ['id', 'goalId', 'archivedAt', 'restoredAt'],
		entries: ['id', 'goalId', 'amount', 'note', 'occurredAt', 'createdAt', 'clientId'],
		asteroids: [
			'id',
			'title',
			'note',
			'createdAt',
			'driftAnchorAt',
			'resolution',
			'resolvedAt',
			'capturedGoalId',
			'captureDismissedAt'
		],
		orbitNotes: ['id', 'goalId', 'periodKey', 'periodStart', 'body', 'createdAt', 'updatedAt']
	};

	const shapes: Record<string, { shape: Record<string, unknown> }> = {
		goals: goalBundleSchema,
		goalArchiveWindows: archiveWindowBundleSchema,
		entries: entryBundleSchema,
		asteroids: asteroidBundleSchema,
		orbitNotes: orbitNoteBundleSchema
	};

	for (const [table, keys] of Object.entries(expected)) {
		it(`${table} carries exactly the columns it is meant to`, () => {
			expect(Object.keys(shapes[table].shape).sort()).toEqual([...keys].sort());
		});
	}

	/**
	 * The one that matters most: this fails the moment somebody adds `profile`,
	 * `reminderSettings`, or any other account-shaped table back to the bundle.
	 * A file about goals has no account in it, and that is what keeps an export
	 * from being able to leak one.
	 */
	it('carries goals and asteroids, and nothing about the account', () => {
		expect(Object.keys(bundleSchema.shape).sort()).toEqual(
			['schemaVersion', 'exportedAt', ...Object.keys(expected)].sort()
		);
	});
});

/**
 * The same guarantee read the other way round: serialise a bundle somebody
 * tried to stuff whole database rows and whole account tables into, and scan
 * the string. Zod strips what it does not declare, so none of it survives to
 * the file.
 */
describe('what never reaches the file', () => {
	/**
	 * Names that must not appear in a bundle, whatever else changes.
	 *
	 * Two groups. The credentials and device rows were never exportable. The
	 * rest — the address, the name, the zone, the preferences, the reminder
	 * terms — are the account itself, which an export deliberately does not
	 * describe: this restores goals, not accounts.
	 */
	const forbidden = [
		'passwordHash',
		'password_hash',
		'argon2',
		'sessions',
		'sessionToken',
		'passwordResetTokens',
		'pushSubscriptions',
		'endpoint',
		'p256dh',
		'expiresAt',
		'usedAt',
		'lastSentAt',
		'lastSeenAt',
		'userAgent',
		'userId',
		'profile',
		'email',
		'@example.com',
		'displayName',
		'timeZone',
		'weekStartsOn',
		'preferences',
		'reminderSettings',
		'quietFrom',
		'quietUntil'
	];

	const contaminated = {
		schemaVersion: TRANSFER_SCHEMA_VERSION,
		exportedAt: T0,
		goals: [{ ...goal(), userId: 'user-1' }],
		goalArchiveWindows: [],
		entries: [],
		asteroids: [{ ...asteroid(), userId: 'user-1' }],
		orbitNotes: [],
		// The whole `users` row, as `select *` would hand it over.
		profile: {
			id: 'user-1',
			email: 'pilot@example.com',
			passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA',
			displayName: 'Pilot',
			timeZone: 'UTC',
			weekStartsOn: 1,
			preferences: { density: 'compact' },
			createdAt: T0
		},
		// Whole tables that have no business travelling at all.
		reminderSettings: { enabled: true, quietFrom: 1320, quietUntil: 420, lastSentAt: T0 },
		sessions: [{ id: 'abc', userId: 'user-1', expiresAt: T0 }],
		passwordResetTokens: [{ id: 'def', userId: 'user-1', usedAt: null }],
		pushSubscriptions: [{ id: 'ghi', endpoint: 'https://push.example/x', p256dh: 'k', auth: 's' }]
	};

	const serialised = JSON.stringify(bundleSchema.parse(contaminated));

	for (const name of forbidden) {
		it(`does not carry ${name}`, () => {
			expect(serialised).not.toContain(name);
		});
	}

	it('keeps the goals it is for', () => {
		expect(serialised).toContain('"title":"Read"');
		expect(serialised).toContain('"title":"Fix the shed"');
	});
});

/* -------------------------------------------------------------------------- */
/* Reading a file                                                              */
/* -------------------------------------------------------------------------- */

describe('readBundle', () => {
	it('reads a bundle it recognises', () => {
		const read = readBundle(JSON.stringify(bundle({ goals: [goal()] })));
		expect(read.ok).toBe(true);
		if (read.ok) expect(read.bundle.goals[0].title).toBe('Read');
	});

	it('refuses a file past the cap before parsing it', () => {
		const read = readBundle(' '.repeat(MAX_BUNDLE_BYTES + 1));
		expect(read.ok).toBe(false);
		if (!read.ok) {
			expect(read.problem.kind).toBe('size');
			// The cap is in the message, so nobody has to guess what "too big" is.
			expect(importProblemMessage(read.problem)).toContain('16 MB');
		}
	});

	it('refuses something that is not JSON', () => {
		const read = readBundle('{ not json');
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.problem.kind).toBe('json');
	});

	it('refuses a newer format rather than reading half of it', () => {
		const read = readBundle(JSON.stringify({ ...bundle(), schemaVersion: 99 }));
		expect(read.ok).toBe(false);
		if (!read.ok) {
			expect(read.problem.kind).toBe('version');
			expect(importProblemMessage(read.problem)).toContain('newer Nova');
		}
	});

	it('refuses an older format with a plain message', () => {
		const read = readBundle(JSON.stringify({ schemaVersion: 0, goals: [] }));
		expect(read.ok).toBe(false);
		if (!read.ok) expect(importProblemMessage(read.problem)).toContain('not a Nova export');
	});

	it('names the row a bad value is in', () => {
		const source = JSON.stringify(
			bundle({ goals: [goal(), goal({ id: 'goal-2', color: 'javascript:alert(1)' })] })
		);
		const read = readBundle(source);
		expect(read.ok).toBe(false);
		if (!read.ok && read.problem.kind === 'schema') {
			expect(read.problem.issues[0]).toContain('goals[1].color');
		} else {
			throw new Error('expected a schema problem');
		}
	});

	it('refuses two rows sharing an id', () => {
		const read = readBundle(JSON.stringify(bundle({ goals: [goal(), goal()] })));
		expect(read.ok).toBe(false);
		if (!read.ok && read.problem.kind === 'schema') {
			expect(read.problem.issues.join(' ')).toContain('share an id');
		} else {
			throw new Error('expected a schema problem');
		}
	});

	it('ignores an account somebody added to a file by hand', () => {
		// A file is about goals. One carrying a profile or reminder terms is not
		// refused — it is read for its goals and the rest is dropped on the floor,
		// because there is nowhere in the bundle for it to land.
		const source = JSON.stringify({
			...bundle({ goals: [goal()] }),
			profile: { email: 'someone@example.com', displayName: 'Someone', timeZone: 'UTC' },
			reminderSettings: { enabled: true, quietFrom: 60, quietUntil: 120 }
		});
		const read = readBundle(source);
		expect(read.ok).toBe(true);
		if (read.ok) {
			expect(read.bundle.goals).toHaveLength(1);
			expect(JSON.stringify(read.bundle)).not.toContain('someone@example.com');
		}
	});

	it('refuses an asteroid that disagrees with itself', () => {
		const read = readBundle(JSON.stringify(bundle({ asteroids: [asteroid({ resolvedAt: T0 })] })));
		expect(read.ok).toBe(false);
		if (!read.ok && read.problem.kind === 'schema') {
			expect(read.problem.issues[0]).toContain('asteroids[0].resolvedAt');
		} else {
			throw new Error('expected a schema problem');
		}
	});
});

/* -------------------------------------------------------------------------- */
/* Remapping                                                                   */
/* -------------------------------------------------------------------------- */

describe('planImport remaps every id', () => {
	it('mints a new id for each goal and never keeps the one in the file', () => {
		const applied = plan(bundle({ goals: [goal()] }));
		expect(applied.goals[0].id).toBe('new-goals-goal-1');
	});

	it('rewrites parentId to the newly minted parent', () => {
		const applied = plan(
			bundle({
				goals: [
					goal({ id: 'child', tier: 'planet', parentId: 'parent' }),
					goal({ id: 'parent', tier: 'starSystem' })
				]
			})
		);
		const child = applied.goals.find((row) => row.id === 'new-goals-child');
		expect(child?.parentId).toBe('new-goals-parent');
	});

	it('inserts a parent before the child that points at it', () => {
		const applied = plan(
			bundle({
				goals: [
					goal({ id: 'child', tier: 'planet', parentId: 'parent' }),
					goal({ id: 'parent', tier: 'starSystem' })
				]
			})
		);
		const order = applied.goals.map((row) => row.id);
		expect(order.indexOf('new-goals-parent')).toBeLessThan(order.indexOf('new-goals-child'));
	});

	it('drops a parent that is not in the file rather than inventing one', () => {
		const applied = plan(bundle({ goals: [goal({ parentId: 'somewhere-else' })] }));
		expect(applied.goals[0].parentId).toBeNull();
	});

	it('drops a row whose goal is not in the file', () => {
		const applied = plan(
			bundle({
				goals: [goal()],
				entries: [entry(), entry({ id: 'entry-2', goalId: 'missing' })],
				orbitNotes: [
					{
						id: 'note-1',
						goalId: 'missing',
						periodKey: 'week:2026-W02',
						periodStart: T0,
						body: 'gone',
						createdAt: T0,
						updatedAt: T0
					}
				],
				goalArchiveWindows: [
					{ id: 'window-1', goalId: 'missing', archivedAt: T0, restoredAt: null }
				]
			})
		);
		expect(applied.entries).toHaveLength(1);
		expect(applied.orbitNotes).toHaveLength(0);
		expect(applied.archiveWindows).toHaveLength(0);
		expect(applied.summary.tables.entries.orphaned).toBe(1);
		expect(applied.summary.tables.orbitNotes.orphaned).toBe(1);
		expect(applied.summary.tables.goalArchiveWindows.orphaned).toBe(1);
	});

	it('keeps a capture whose goal did not travel, without the link', () => {
		const applied = plan(
			bundle({
				asteroids: [
					asteroid({
						resolution: 'captured',
						resolvedAt: T0 - DAY,
						capturedGoalId: 'not-in-here'
					})
				]
			})
		);
		expect(applied.asteroids[0].capturedGoalId).toBeNull();
		expect(applied.asteroids[0].resolution).toBe('captured');
		expect(applied.asteroids[0].resolvedAt).toEqual(new Date(T0 - DAY));
	});

	it('relinks a capture whose goal did travel', () => {
		const applied = plan(
			bundle({
				goals: [goal()],
				asteroids: [asteroid({ resolution: 'captured', resolvedAt: T0, capturedGoalId: 'goal-1' })]
			})
		);
		expect(applied.asteroids[0].capturedGoalId).toBe('new-goals-goal-1');
	});

	it('keeps the note on the period it was written against', () => {
		const applied = plan(
			bundle({
				goals: [goal()],
				orbitNotes: [
					{
						id: 'note-1',
						goalId: 'goal-1',
						periodKey: 'week:2026-W02',
						periodStart: T0,
						body: 'a hard week',
						createdAt: T0,
						updatedAt: T0
					}
				]
			})
		);
		expect(applied.orbitNotes[0].periodKey).toBe('week:2026-W02');
		expect(applied.orbitNotes[0].periodStart).toEqual(new Date(T0));
	});
});

describe('planImport checks the nesting rules the database cannot', () => {
	it('refuses a parent with a shorter cadence', () => {
		const result = planImport(
			bundle({
				goals: [
					goal({ id: 'child', tier: 'starSystem', parentId: 'parent' }),
					goal({ id: 'parent', tier: 'satellite' })
				]
			}),
			EMPTY_ACCOUNT,
			{ mode: 'merge', mintId }
		);
		expect(result.ok).toBe(false);
		if (!result.ok && result.problem.kind === 'nesting') {
			expect(importProblemMessage(result.problem)).toContain('longer cadence');
		} else {
			throw new Error('expected a nesting problem');
		}
	});

	it('refuses a loop', () => {
		const result = planImport(
			bundle({
				goals: [
					goal({ id: 'a', tier: 'planet', parentId: 'b' }),
					goal({ id: 'b', tier: 'starSystem', parentId: 'a' })
				]
			}),
			EMPTY_ACCOUNT,
			{ mode: 'merge', mintId }
		);
		expect(result.ok).toBe(false);
		if (!result.ok && result.problem.kind === 'nesting') {
			expect(result.problem.row).toContain('goals[');
		} else {
			throw new Error('expected a nesting problem');
		}
	});

	it('refuses a goal that claims to be its own parent', () => {
		const result = planImport(
			bundle({ goals: [goal({ id: 'loop', parentId: 'loop' })] }),
			EMPTY_ACCOUNT,
			{ mode: 'merge', mintId }
		);
		expect(result.ok).toBe(false);
	});
});

/* -------------------------------------------------------------------------- */
/* Merging twice                                                               */
/* -------------------------------------------------------------------------- */

describe('a merge run twice', () => {
	const source = bundle({
		goals: [goal(), goal({ id: 'goal-2', title: 'Run', sortOrder: 1 })],
		goalArchiveWindows: [
			{ id: 'window-1', goalId: 'goal-1', archivedAt: T0 - 20 * DAY, restoredAt: T0 - 10 * DAY }
		],
		entries: [
			entry(),
			// One from the offline queue, one from before the queue existed.
			entry({ id: 'entry-2', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
			entry({ id: 'entry-3', goalId: 'goal-2', clientId: null })
		],
		asteroids: [asteroid()],
		orbitNotes: [
			{
				id: 'note-1',
				goalId: 'goal-1',
				periodKey: 'week:2026-W02',
				periodStart: T0,
				body: 'steady',
				createdAt: T0,
				updatedAt: T0
			}
		]
	});

	const first = plan(source);

	it('writes everything the first time', () => {
		expect(first.goals).toHaveLength(2);
		expect(first.entries).toHaveLength(3);
		expect(first.asteroids).toHaveLength(1);
		expect(first.orbitNotes).toHaveLength(1);
		expect(first.archiveWindows).toHaveLength(1);
	});

	it('gives an entry that never had a client id a deterministic one', () => {
		const minted = first.entries.find((row) => row.id === 'new-entries-entry-1');
		expect(minted?.clientId).toBe(importedClientId('entry-1'));
	});

	it('leaves an entry that had one alone', () => {
		const kept = first.entries.find((row) => row.id === 'new-entries-entry-2');
		expect(kept?.clientId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
	});

	it('writes nothing at all the second time', () => {
		const second = plan(source, accountAfter(first));
		expect(second.goals).toHaveLength(0);
		expect(second.entries).toHaveLength(0);
		expect(second.asteroids).toHaveLength(0);
		expect(second.orbitNotes).toHaveLength(0);
		expect(second.archiveWindows).toHaveLength(0);
	});

	it('counts the second run as duplicates rather than additions', () => {
		const second = plan(source, accountAfter(first));
		expect(second.summary.tables.entries).toMatchObject({
			inFile: 3,
			added: 0,
			duplicate: 3,
			orphaned: 0
		});
		expect(second.summary.tables.goals).toMatchObject({ inFile: 2, added: 0, duplicate: 2 });
	});

	it('restores an entry that was deleted between the two runs', () => {
		const after = accountAfter(first);
		const survivors = [...after.entryKeys];
		const account: AccountShape = { ...after, entryKeys: new Set(survivors.slice(1)) };

		const second = plan(source, account);
		expect(second.entries).toHaveLength(1);
		expect(second.summary.tables.entries.added).toBe(1);
	});
});

describe('merge never edits what is already there', () => {
	it('plans nothing but goal and asteroid rows, in either mode', () => {
		// The plan is the whole of what the writer applies, so a plan with no
		// account in it is an import that cannot change one.
		for (const mode of ['merge', 'replace'] as const) {
			const applied = plan(bundle({ goals: [goal()] }), EMPTY_ACCOUNT, mode);
			expect(Object.keys(applied).sort()).toEqual(
				[
					'archiveWindows',
					'asteroids',
					'entries',
					'goals',
					'mode',
					'orbitNotes',
					'summary',
					'wipeFirst'
				].sort()
			);
		}
	});

	it('lands imported goals after the ones already in the account', () => {
		const source = bundle({
			goals: [goal({ sortOrder: 0 }), goal({ id: 'goal-2', sortOrder: 1 })]
		});
		const account: AccountShape = { ...EMPTY_ACCOUNT, highestSortOrder: 4 };
		expect(plan(source, account).goals.map((row) => row.sortOrder)).toEqual([5, 6]);
	});
});

/* -------------------------------------------------------------------------- */
/* Replacing                                                                   */
/* -------------------------------------------------------------------------- */

describe('replace', () => {
	const source = bundle({ goals: [goal()], entries: [entry()] });
	const account: AccountShape = {
		...EMPTY_ACCOUNT,
		highestSortOrder: 9,
		counts: { goals: 3, goalArchiveWindows: 1, entries: 40, asteroids: 2, orbitNotes: 5 }
	};

	it('says what it would delete before it deletes it', () => {
		const applied = plan(source, account, 'replace');
		expect(applied.wipeFirst).toBe(true);
		expect(applied.summary.tables.entries.deleted).toBe(40);
		expect(applied.summary.tables.goals.deleted).toBe(3);
	});

	it('imports into the cleared account, so nothing counts as a duplicate', () => {
		const applied = plan(source, { ...account, goalIds: new Set(['new-goals-goal-1']) }, 'replace');
		expect(applied.goals).toHaveLength(1);
		expect(applied.summary.tables.goals.duplicate).toBe(0);
	});

	it('numbers goals from the start again', () => {
		expect(plan(source, account, 'replace').goals[0].sortOrder).toBe(0);
	});

	it('clears goals and asteroids, and leaves the account settings alone', () => {
		// `wipeFirst` is the only deletion the writer performs, and it is scoped
		// to the two tables an import can write. Nothing here says anything about
		// the name, the zone, the week start or the reminder terms.
		const applied = plan(source, account, 'replace');
		expect(applied.wipeFirst).toBe(true);
		expect(JSON.stringify(applied)).not.toContain('timeZone');
	});
});

/* -------------------------------------------------------------------------- */
/* A file that collides with itself                                            */
/* -------------------------------------------------------------------------- */

describe('a file that repeats itself', () => {
	it('writes one entry per (goal, client id) pair, not two', () => {
		const applied = plan(
			bundle({
				goals: [goal()],
				entries: [
					entry({ id: 'entry-1', clientId: 'shared-client-id' }),
					entry({ id: 'entry-2', clientId: 'shared-client-id' })
				]
			})
		);
		expect(applied.entries).toHaveLength(1);
		expect(applied.summary.tables.entries.duplicate).toBe(1);
	});

	it('writes one note per (goal, period) pair', () => {
		const note = {
			id: 'note-1',
			goalId: 'goal-1',
			periodKey: 'week:2026-W02',
			periodStart: T0,
			body: 'one',
			createdAt: T0,
			updatedAt: T0
		};
		const applied = plan(
			bundle({ goals: [goal()], orbitNotes: [note, { ...note, id: 'note-2', body: 'two' }] })
		);
		expect(applied.orbitNotes).toHaveLength(1);
	});
});
