/**
 * Mints a password reset link from the command line and prints it.
 *
 * The way back in when an instance sends no mail — or when its mail is broken,
 * which is exactly when you need it. The link is the same single-use,
 * half-hour token the email carries, so nothing here is a back door the web
 * flow does not already have; it just hands the link to whoever is holding the
 * server instead of to a mailbox.
 *
 *   node scripts/reset-password.mjs pilot@example.com
 *   node scripts/reset-password.mjs pilot@example.com --origin https://nova.example.com
 */
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';

const LIFETIME_MS = 30 * 60 * 1000;

const [emailArg, ...rest] = process.argv.slice(2);
if (!emailArg) {
	console.error('usage: node scripts/reset-password.mjs <email> [--origin https://host]');
	process.exit(1);
}

const originFlag = rest.indexOf('--origin');
const origin = (
	originFlag === -1 ? (process.env.ORIGIN ?? 'http://localhost:3000') : rest[originFlag + 1]
)?.replace(/\/+$/, '');

if (!origin) {
	console.error('--origin needs a URL, or set ORIGIN in the environment.');
	process.exit(1);
}

const url = process.env.DATABASE_URL ?? 'file:./data/nova.db';
const file = url.startsWith('file:') ? url.slice('file:'.length) : url;

const sqlite = new Database(file);
sqlite.pragma('foreign_keys = ON');

const email = emailArg.trim().toLowerCase();
const user = sqlite.prepare('SELECT id, display_name FROM users WHERE email = ?').get(email);

if (!user) {
	// The web flow is deliberately vague about which addresses exist; an
	// operator with a shell on the box is owed a straight answer.
	console.error(`No account with the address ${email}.`);
	process.exit(1);
}

const token = randomBytes(32).toString('base64url');
const now = Date.now();

sqlite.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
sqlite
	.prepare(
		'INSERT INTO password_reset_tokens (id, user_id, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, NULL)'
	)
	.run(createHash('sha256').update(token).digest('hex'), user.id, now + LIFETIME_MS, now);

sqlite.close();

console.log(`Reset link for ${user.display_name} <${email}> — works once, expires in 30 minutes:`);
console.log(`${origin}/reset?token=${encodeURIComponent(token)}`);
