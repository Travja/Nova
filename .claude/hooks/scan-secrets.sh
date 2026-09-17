#!/bin/bash
# Blocks a commit that would put a credential into history.
#
# A throwaway VAPID key went in during #19 and cost a history rewrite to get
# back out — "it's only a test key" is not a defence, because the scanner that
# blocks the merge cannot tell and neither can anyone reading the repo later.
#
# No gitleaks here: it is not installed in these containers, and a gate that
# depends on something absent is not a gate.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

git diff --cached --name-only >/dev/null 2>&1 || exit 0

git diff --cached -U0 -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null | python3 -c '
import math, re, sys

# Anything matching one of these is a credential regardless of how it reads.
SIGNATURES = [
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "a PEM private key"),
    (r"\bghp_[A-Za-z0-9]{36}\b", "a GitHub token"),
    (r"\bgithub_pat_[A-Za-z0-9_]{50,}\b", "a GitHub fine-grained token"),
    (r"\bAKIA[0-9A-Z]{16}\b", "an AWS access key id"),
    (r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b", "a Slack token"),
]

# A long, random-looking value assigned to a name that means "credential".
ASSIGNMENT = re.compile(
    r"(?i)\b([a-z0-9_]*(?:vapid|secret|token|api[_-]?key|private[_-]?key|password|passwd|credential)[a-z0-9_]*)"
    r"\s*[:=]\s*[\x27\"`]?([A-Za-z0-9+/=_-]{32,})",
)

def entropy(value: str) -> float:
    counts = {c: value.count(c) for c in set(value)}
    return -sum((n / len(value)) * math.log2(n / len(value)) for n in counts.values())

findings, path = [], "?"
for line in sys.stdin:
    if line.startswith("+++ b/"):
        path = line[6:].strip()
        continue
    if not line.startswith("+"):
        continue
    body = line[1:]

    for pattern, what in SIGNATURES:
        if re.search(pattern, body):
            findings.append((path, what, body.strip()[:60]))

    for name, value in ASSIGNMENT.findall(body):
        # A stored hash is not a credential, and neither is an obvious placeholder.
        if "hash" in name.lower():
            continue
        if entropy(value) > 3.5:
            findings.append((path, f"a high-entropy value assigned to {name}", value[:24] + "..."))

if findings:
    print("BLOCKED: this commit would put a credential into git history.\n", file=sys.stderr)
    for path, what, sample in findings:
        print(f"  {path}: {what}\n    {sample}", file=sys.stderr)
    print(
        "\nGenerate it at runtime or read it from .env (gitignored), and document the\n"
        "variable in .env.example with a placeholder. If it is already committed, the\n"
        "fix is rewriting history, not a follow-up commit.",
        file=sys.stderr,
    )
    sys.exit(1)
' || exit 2
exit 0
