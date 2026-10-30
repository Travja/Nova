#!/usr/bin/env node
/**
 * Proves that a backup Nova actually took can be restored, following the
 * README's own *Restoring* steps rather than a script's idea of what those
 * steps should be (#65).
 *
 * Usage:
 *   node scripts/restore-drill.mjs <image>
 *
 * Starts the image on an empty volume, creates an account with a goal and an
 * entry through the app's own forms, waits for the automatic backup schedule
 * to take a snapshot, then follows the README's restore steps on that same
 * volume and checks the account, goal and entry came back.
 *
 * Nothing here writes to the database directly — the snapshot comes from
 * Nova's own backup code (the schedule in `src/lib/server/backup`), and the
 * only thing run against the restored file by hand is a read-only count.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const [, , image] = process.argv;
if (!image) {
	console.error('usage: node scripts/restore-drill.mjs <image>');
	process.exit(1);
}

const RUN = randomUUID().slice(0, 8);
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EMAIL = `restore-drill-${RUN}@example.com`;
const PASSWORD = 'restore-drill-password';
const VOLUME = `nova-restore-drill-${RUN}`;
const CONTAINER = `nova-restore-drill-${RUN}`;

function docker(args) {
	return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function dockerQuiet(args) {
	try {
		return docker(args);
	} catch {
		return null;
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, timeoutMs, attempt) {
	const started = Date.now();
	for (;;) {
		const result = await attempt();
		if (result) return result;
		if (Date.now() - started > timeoutMs) {
			throw new Error(`timed out waiting for ${label} after ${timeoutMs}ms`);
		}
		await sleep(1000);
	}
}

async function waitForHealth() {
	return waitFor('/health', 60_000, async () => {
		try {
			const response = await fetch(`${BASE_URL}/health`);
			return response.status === 200;
		} catch {
			return false;
		}
	});
}

/** `createSnapshot` in `$lib/server/backup/snapshot.ts` names these `nova-<timestamp>Z.db`. */
async function waitForSnapshot() {
	return waitFor('a snapshot in /data/backups', 90_000, () => {
		const listing = dockerQuiet([
			'run',
			'--rm',
			'-v',
			`${VOLUME}:/data`,
			'alpine:3.20',
			'sh',
			'-c',
			"ls /data/backups 2>/dev/null | grep -E '^nova-[0-9]{8}T[0-9]{6}Z\\.db$' | sort | tail -n1"
		]);
		return listing || null;
	});
}

function setCookieValue(response) {
	const cookies = response.headers.getSetCookie?.() ?? [];
	const nova = cookies.find((cookie) => cookie.startsWith('nova_session='));
	if (!nova) throw new Error('expected a nova_session cookie, got none');
	return nova.split(';')[0];
}

function postForm(path, fields, cookie) {
	return fetch(`${BASE_URL}${path}`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			origin: BASE_URL,
			// Without an Accept header, SvelteKit's content negotiation treats a
			// fetch POST as a JS `use:enhance` submission and answers with a
			// devalue-wrapped 200 instead of a real redirect — asking for HTML
			// gets the same response a browser's plain form post would get.
			accept: 'text/html',
			...(cookie ? { cookie } : {})
		},
		body: new URLSearchParams(fields)
	});
}

async function register() {
	const response = await postForm('/register', {
		email: EMAIL,
		password: PASSWORD,
		displayName: 'Restore Drill',
		timeZone: 'UTC',
		weekStartsOn: '1'
	});
	await response.arrayBuffer();
	if (response.status !== 303) {
		throw new Error(`registration expected a redirect, got ${response.status}`);
	}
	return setCookieValue(response);
}

async function createGoal(cookie) {
	const response = await postForm(
		'/goals/new',
		{
			title: 'Restore drill goal',
			tier: 'satellite',
			metricKind: 'count',
			target: '1'
		},
		cookie
	);
	await response.arrayBuffer();
	const location = response.headers.get('location');
	if (response.status !== 303 || !location) {
		throw new Error(`goal creation expected a redirect, got ${response.status}`);
	}
	const match = /\/goals\/([^/?]+)/.exec(location);
	if (!match) throw new Error(`could not read a goal id out of ${location}`);
	return match[1];
}

async function logEntry(cookie, goalId) {
	const response = await postForm(`/goals/${goalId}?/log`, { amount: '1' }, cookie);
	await response.arrayBuffer();
	if (response.status !== 200) {
		throw new Error(`logging an entry expected 200, got ${response.status}`);
	}
}

async function signIn() {
	const response = await postForm('/login?/password', { email: EMAIL, password: PASSWORD });
	await response.arrayBuffer();
	if (response.status !== 303) {
		throw new Error(`sign-in after restore expected a redirect, got ${response.status}`);
	}
}

/** `select count(*) from users, goals, entries`, read-only and after the fact. */
function countRows() {
	const output = docker([
		'run',
		'--rm',
		'-v',
		`${VOLUME}:/data`,
		'alpine:3.20',
		'sh',
		'-c',
		'apk add --no-cache --quiet sqlite >/dev/null && ' +
			'sqlite3 /data/nova.db ' +
			'"select (select count(*) from users), (select count(*) from goals), (select count(*) from entries);"'
	]);
	const [users, goals, entries] = output.split('|').map(Number);
	return { users, goals, entries };
}

function startContainer() {
	docker([
		'run',
		'-d',
		'--name',
		CONTAINER,
		'-p',
		`${PORT}:3000`,
		'-e',
		`ORIGIN=${BASE_URL}`,
		'-v',
		`${VOLUME}:/data`,
		image
	]);
}

function cleanup() {
	dockerQuiet(['rm', '-f', CONTAINER]);
	dockerQuiet(['volume', 'rm', '-f', VOLUME]);
}

async function main() {
	cleanup();
	docker(['volume', 'create', VOLUME]);

	console.log(`starting ${image} on an empty volume`);
	startContainer();
	await waitForHealth();

	console.log('creating an account, a goal and an entry through the app’s own forms');
	const cookie = await register();
	const goalId = await createGoal(cookie);
	await logEntry(cookie, goalId);

	console.log('waiting for the backup schedule to take a snapshot');
	const snapshot = await waitForSnapshot();
	console.log(`snapshot taken: ${snapshot}`);

	console.log('stopping the writer before touching its files');
	docker(['stop', CONTAINER]);

	// README, "Restoring", verbatim: copy the snapshot over nova.db and drop
	// the WAL sidecars, which belong to the database just replaced.
	// --user 1000:1000 matters as much as the commands: root's cp would leave
	// nova.db owned by root, and the container runs as the unprivileged
	// `node` user (uid 1000 in every node:*-alpine image), which could then
	// open it to read but not to write.
	docker([
		'run',
		'--rm',
		'--user',
		'1000:1000',
		'-v',
		`${VOLUME}:/data`,
		'alpine:3.20',
		'sh',
		'-c',
		`cp /data/nova.db /data/nova.db.before-restore 2>/dev/null; ` +
			`cp /data/backups/${snapshot} /data/nova.db && ` +
			`rm -f /data/nova.db-wal /data/nova.db-shm`
	]);
	docker(['rm', CONTAINER]);
	console.log(`starting ${image} back up on the restored volume`);
	startContainer();
	await waitForHealth();

	console.log('checking the account, goal and entry count came back');
	await signIn();
	const counts = countRows();
	console.log('row counts after restore:', counts);
	if (counts.users !== 1 || counts.goals !== 1 || counts.entries !== 1) {
		throw new Error(`expected 1 user, 1 goal and 1 entry, got ${JSON.stringify(counts)}`);
	}

	console.log('restore drill passed');
}

main()
	.catch((error) => {
		console.error(error);
		const logs = dockerQuiet(['logs', CONTAINER]);
		if (logs) console.error(`--- docker logs ${CONTAINER} ---\n${logs}`);
		process.exitCode = 1;
	})
	.finally(cleanup);
