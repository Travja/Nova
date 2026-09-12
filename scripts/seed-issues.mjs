/**
 * Creates the milestones, labels and issues described in `docs/issues/`.
 *
 * The issues already exist on Travja/Nova — this is for re-seeding a fork, or
 * restoring them if they are ever lost.
 *
 * Requires the GitHub CLI, authenticated with write access to the repository:
 *
 *   gh auth login
 *   node scripts/seed-issues.mjs            # dry run, prints what it would do
 *   node scripts/seed-issues.mjs --apply    # actually creates them
 *
 * Re-running skips any issue whose exact title already exists, so it is safe
 * after a partial run.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ISSUE_DIR = 'docs/issues';
const apply = process.argv.includes('--apply');

const LABEL_COLORS = {
	enhancement: 'a2eeef',
	design: 'd4a5ff',
	frontend: 'bfd4f2',
	backend: 'c2e0c6',
	pwa: 'fef2c0',
	a11y: '0e8a16',
	security: 'd93f0b',
	performance: 'fbca04',
	ops: 'c5def5',
	documentation: '0075ca',
	'needs-design': 'e99695',
	'good-first-issue': '7057ff'
};

function gh(args) {
	try {
		return execFileSync('gh', args, { encoding: 'utf8' }).trim();
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.error(
				'The GitHub CLI is required. Install it from https://cli.github.com and run `gh auth login`.'
			);
			process.exit(1);
		}
		throw error;
	}
}

/** Split `---` front matter from the issue body. */
function parse(file) {
	const raw = readFileSync(join(ISSUE_DIR, file), 'utf8');
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
	if (!match) throw new Error(`${file} is missing front matter`);

	const [, frontMatter, body] = match;
	const meta = {};
	for (const line of frontMatter.split('\n')) {
		const separator = line.indexOf(':');
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (value.startsWith('[') && value.endsWith(']')) {
			meta[key] = value
				.slice(1, -1)
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean);
			continue;
		}
		if (
			(value.startsWith("'") && value.endsWith("'")) ||
			(value.startsWith('"') && value.endsWith('"'))
		) {
			value = value.slice(1, -1);
		}
		meta[key] = value;
	}

	return { file, title: meta.title, labels: meta.labels ?? [], milestone: meta.milestone, body };
}

const issues = readdirSync(ISSUE_DIR)
	.filter((file) => file.endsWith('.md'))
	.sort()
	.map(parse);

// A dry run only reads local files, so it works without the CLI installed.
if (!apply) {
	console.log(`Would create ${issues.length} issues:\n`);
	for (const issue of issues) {
		console.log(`  ${issue.milestone}`);
		console.log(`    ${issue.title}  [${issue.labels.join(', ')}]`);
	}
	console.log('\nRe-run with --apply to create them.');
	process.exit(0);
}

const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
console.log(`Creating ${issues.length} issues in ${repo}\n`);

// Labels and milestones have to exist before an issue can reference them.
for (const [name, color] of Object.entries(LABEL_COLORS)) {
	try {
		gh(['label', 'create', name, '--color', color, '--force']);
	} catch {
		console.warn(`  could not create label ${name}`);
	}
}

for (const milestone of [...new Set(issues.map((issue) => issue.milestone))]) {
	try {
		gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`, '--silent']);
	} catch {
		// Already exists, which is the common case on a re-run.
	}
}

const existing = new Set(
	gh(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'title', '-q', '.[].title'])
		.split('\n')
		.filter(Boolean)
);

for (const issue of issues) {
	if (existing.has(issue.title)) {
		console.log(`  skipped (exists): ${issue.title}`);
		continue;
	}

	const args = ['issue', 'create', '--title', issue.title, '--body', issue.body];
	for (const label of issue.labels) args.push('--label', label);
	if (issue.milestone) args.push('--milestone', issue.milestone);

	console.log(`  created: ${gh(args)}`);
}
