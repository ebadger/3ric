#!/bin/sh
# check-learnings-budget.sh -- Enforce the docs/LEARNINGS.md size cap.
#
# Why: docs/LEARNINGS.md is mandatory reading at the start of EVERY session, so it
# is loaded into the model's context every single time. If it grows without bound
# it crowds out task context and buries the durable rules among one-off incident
# detail. It is therefore a *capped Tier-1 rules digest*; detailed narratives live
# in docs/learnings/ (read on demand). See LEARNINGS.md "How this file is maintained".
#
# Cap: 2,500 tokens. Counts REAL tokens with tiktoken when available
# (python3 + `pip install tiktoken`); otherwise falls back to a character proxy.
#
# Usage: check-learnings-budget.sh [path-to-markdown]   # defaults to docs/LEARNINGS.md
#
# Exit: 0 = within budget (or unenforceable -> fail-open with a note);
#       1 = over budget (blocks the push).
# Escape hatch (rare, deliberate): SKIP_LEARNINGS_BUDGET=1
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
FILE="${1:-$REPO_ROOT/docs/LEARNINGS.md}"

TOKEN_CAP=2500
CHAR_CAP=9800   # ~2,500 tokens at the measured ~3.8 chars/token (loose dependency-free backstop)

# Print remediation guidance for "$1" (a measurement string) and block the push.
block() {
  echo "" >&2
  echo "x LEARNINGS budget BLOCKED: $1" >&2
  echo "  LEARNINGS.md is the always-loaded Tier-1 rules digest, not an append-only log." >&2
  echo "  Get back under the cap via priority-based distillation:" >&2
  echo "    1. Move the full incident narrative to docs/learnings/ (sessions/ or archive/)." >&2
  echo "    2. Leave only a distilled rule + one-line WHY (+ archive link) in LEARNINGS.md." >&2
  echo "    3. Dedup/merge overlapping rules; demote the lowest-value detail to the archive." >&2
  echo "  Override (only if you are certain): SKIP_LEARNINGS_BUDGET=1 git push ..." >&2
  echo "" >&2
  exit 1
}

if [ "${SKIP_LEARNINGS_BUDGET:-}" = "1" ]; then
  echo "check-learnings-budget: SKIP_LEARNINGS_BUDGET=1 -- skipping." >&2
  exit 0
fi

if [ ! -f "$FILE" ]; then
  echo "check-learnings-budget: $FILE not found -- skipping (fail-open)." >&2
  exit 0
fi

# Prefer an exact token count via tiktoken.
PY=""
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
fi

if [ -n "$PY" ]; then
  tokens=$("$PY" - "$FILE" <<'PYEOF' 2>/dev/null || true
import sys
try:
    import tiktoken
except Exception:
    sys.exit(3)
data = open(sys.argv[1], encoding="utf-8").read()
print(len(tiktoken.get_encoding("cl100k_base").encode(data)))
PYEOF
)
  tokens=$(printf '%s' "${tokens:-}" | tr -cd '0-9')
  if [ -n "$tokens" ]; then
    if [ "$tokens" -gt "$TOKEN_CAP" ]; then
      block "docs/LEARNINGS.md is $tokens tokens (cap $TOKEN_CAP)."
    fi
    echo "check-learnings-budget: OK ($tokens / $TOKEN_CAP tokens)." >&2
    exit 0
  fi
  echo "check-learnings-budget: tiktoken unavailable -- using char proxy ('pip install tiktoken' for exact token enforcement)." >&2
fi

# Fallback: dependency-free character proxy.
chars=$(wc -m < "$FILE" 2>/dev/null | tr -cd '0-9')
[ -n "$chars" ] || chars=$(wc -c < "$FILE" | tr -cd '0-9')
if [ "$chars" -gt "$CHAR_CAP" ]; then
  block "docs/LEARNINGS.md is $chars chars (proxy cap $CHAR_CAP ~ $TOKEN_CAP tokens)."
fi
echo "check-learnings-budget: OK ($chars chars; proxy cap $CHAR_CAP ~ $TOKEN_CAP tokens)." >&2
exit 0
