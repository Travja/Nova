/** Drops the end-to-end database so each run starts from an empty universe. */
import { rmSync } from 'node:fs';

for (const suffix of ['', '-wal', '-shm']) {
	rmSync(`data/e2e.db${suffix}`, { force: true });
}
