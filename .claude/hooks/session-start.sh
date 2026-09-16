#!/bin/bash
# Orientation for a session that starts knowing nothing about this repo.
#
# Two jobs. Install dependencies so `pnpm test` works on the first try rather
# than after a session discovers it needs to, and print a map of where the logic
# lives — which is the thing sessions otherwise rebuild by reading whole modules
# looking for one function.
#
# Stays synchronous on purpose: the map only reaches the session if it is on
# stdout before the agent starts, and async mode replaces stdout with a control
# frame.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

# Installing is worth it on a fresh remote container, and a no-op locally where
# node_modules is already there. Never fail the session over it.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || [ ! -d node_modules ]; then
	corepack enable >/dev/null 2>&1
	pnpm install --frozen-lockfile >/dev/null 2>&1 || echo "  ! pnpm install failed — run it by hand before trusting a test run"
fi

head_line="$(git log --oneline -1 2>/dev/null || echo 'no commits')"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
dirty="clean"
[ -n "$(git status --porcelain 2>/dev/null)" ] && dirty="UNCOMMITTED CHANGES"

echo "Nova — $branch @ $head_line ($dirty)"
echo "Verify before a PR: pnpm lint && pnpm check && pnpm test && pnpm e2e"
echo
echo "Where the logic lives (generated at session start — prefer this to grepping):"

# One line per module: its exported functions and consts. Types are left out;
# somebody looking for a type is already in the right file.
for dir in src/lib/domain src/lib/server; do
	find "$dir" -name '*.ts' ! -name '*.test.ts' | sort | while read -r file; do
		names="$(grep -oE '^export (async )?(function|const|class) [A-Za-z0-9_]+' "$file" 2>/dev/null |
			sed -E 's/^export (async )?(function|const|class) //')"
		[ -z "$names" ] && continue
		total="$(printf '%s\n' "$names" | wc -l | tr -d ' ')"
		# Truncate by symbol rather than by character: half a name is worse than
		# no name, because it is not greppable either.
		shown="$(printf '%s\n' "$names" | head -8 | paste -sd, - | sed 's/,/, /g')"
		[ "$total" -gt 8 ] && shown="$shown (+$((total - 8)) more)"
		printf '  %-29s %s\n' "${file#src/lib/}" "$shown"
	done
done

echo
echo "Conventions are in CLAUDE.md (already loaded). docs/ROADMAP.md marks which"
echo "issues are done; each has a spec at docs/issues/NN-*.md — read yours first."
