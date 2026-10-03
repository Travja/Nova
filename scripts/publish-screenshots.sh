#!/usr/bin/env bash
# Publish screenshots to the `screenshots` branch and print their URLs.
#
#   scripts/publish-screenshots.sh <dir> <issue>-<slug>
#   scripts/publish-screenshots.sh .screenshots/11-system-view 11-system-view
#
# Screenshots never go on `main`: every clone would carry them forever. They
# live on an orphan branch instead, and docs and pull requests link to them by
# raw URL. Each PNG in <dir> lands at <issue>-<slug>/<name> on that branch,
# replacing one of the same name.
set -euo pipefail

if [ $# -ne 2 ] || [ ! -d "$1" ]; then
	echo "usage: $0 <dir> <issue>-<slug>" >&2
	exit 64
fi

src=$(cd "$1" && pwd)
dest=$2
branch=screenshots
base=https://raw.githubusercontent.com/Travja/Nova/$branch

work=$(mktemp -d)
trap 'git worktree remove --force "$work" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

git fetch --quiet origin "$branch"
git worktree add --quiet --detach "$work" "origin/$branch"

mkdir -p "$work/$dest"
cp "$src"/*.png "$work/$dest/"

cd "$work"
git add -A "$dest"
if git diff --cached --quiet; then
	echo "Nothing new to publish." >&2
else
	git commit --quiet -m "Screenshots for $dest"
	git push --quiet origin "HEAD:$branch"
fi

for file in "$dest"/*.png; do
	echo "$base/$file"
done
