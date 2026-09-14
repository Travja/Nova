/**
 * Drops an end-to-end database so each run starts from an empty universe.
 *
 * Takes the file to drop as an argument, defaulting to the dev server's. The
 * production-build server the offline suite runs against keeps its own file, so
 * the two can run side by side; only the default run clears the mail outbox,
 * which is shared and belongs to the suite that reads it.
 */
import { rmSync } from 'node:fs';

const file = process.argv[2] ?? 'data/e2e.db';

for (const suffix of ['', '-wal', '-shm']) {
	rmSync(`${file}${suffix}`, { force: true });
}

// And the mail the last run "sent", so an old reset link cannot be mistaken
// for a fresh one.
if (!process.argv[2]) rmSync('data/e2e-outbox', { force: true, recursive: true });
