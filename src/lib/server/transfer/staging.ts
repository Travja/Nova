import type { ImportMode } from '$domain/transfer';
import { newToken } from '$lib/server/auth/token';

/**
 * The file, held between the dry run and the post that confirms it.
 *
 * Importing is two posts on purpose — you see what a file would do before it
 * does it — and the file has to survive between them. Sending it twice would
 * mean a second upload of up to `MAX_BUNDLE_BYTES`, and putting it in a hidden
 * field would mean the browser holding the whole thing in the DOM and posting
 * it back, so it stays on the server under a token instead. That also keeps
 * the confirming post working with no JavaScript at all, which is the rule the
 * rest of the app's forms follow.
 *
 * In process rather than in a table, for the same reason `InProcessLimiter`
 * is: Nova is one Node process with one SQLite file beside it, and a staged
 * upload is worth nothing once that process is gone. A restart between the two
 * posts loses the token, and the screen says to choose the file again.
 *
 * Every read is scoped to the account that staged it, so a token guessed or
 * copied from somewhere else resolves to nothing.
 */

/** Long enough to read a summary and think about it, short enough to forget. */
const TTL_MS = 15 * 60 * 1000;

/** How much staged text this process will hold across every account at once. */
const CAPACITY_BYTES = 48 * 1024 * 1024;

interface Staged {
	userId: string;
	source: string;
	/**
	 * The mode the summary on screen was computed for.
	 *
	 * Staged with the file rather than re-read from the confirming post, so a
	 * merge that was previewed cannot be confirmed as a replace by editing one
	 * hidden field. What was shown is what runs.
	 */
	mode: ImportMode;
	stagedAt: number;
}

const staged = new Map<string, Staged>();

function sizeOf(entry: Staged): number {
	return entry.source.length;
}

/** Drop what has expired, then the oldest, until the process is under capacity. */
function evict(now: number) {
	for (const [token, entry] of staged) {
		if (now - entry.stagedAt > TTL_MS) staged.delete(token);
	}

	let held = 0;
	for (const entry of staged.values()) held += sizeOf(entry);

	// `Map` iterates in insertion order, so this is oldest first.
	for (const [token, entry] of staged) {
		if (held <= CAPACITY_BYTES) break;
		staged.delete(token);
		held -= sizeOf(entry);
	}
}

/** Hold a validated upload for this account, and return the handle to it. */
export function stageBundle(
	userId: string,
	source: string,
	mode: ImportMode,
	now = Date.now()
): string {
	evict(now);
	const token = newToken();
	staged.set(token, { userId, source, mode, stagedAt: now });
	return token;
}

/** The staged upload, or null when it expired, never existed, or is not theirs. */
export function readStaged(
	userId: string,
	token: string,
	now = Date.now()
): { source: string; mode: ImportMode } | null {
	evict(now);
	const entry = staged.get(token);
	if (!entry || entry.userId !== userId) return null;
	return { source: entry.source, mode: entry.mode };
}

/** Let go of a staged upload — once it is applied there is nothing to confirm. */
export function dropStaged(token: string): void {
	staged.delete(token);
}

/** Forget everything this account staged, which is what deleting it should do. */
export function dropStagedFor(userId: string): void {
	for (const [token, entry] of staged) {
		if (entry.userId === userId) staged.delete(token);
	}
}
