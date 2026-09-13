/** Drops the end-to-end database so each run starts from an empty universe. */
import { rmSync } from 'node:fs';

for (const suffix of ['', '-wal', '-shm']) {
	rmSync(`data/e2e.db${suffix}`, { force: true });
}

// And the mail the last run "sent", so an old reset link cannot be mistaken
// for a fresh one.
rmSync('data/e2e-outbox', { force: true, recursive: true });
