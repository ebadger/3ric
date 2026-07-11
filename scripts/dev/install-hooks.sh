#!/usr/bin/env bash
# install-hooks.sh — Activate this repo's git hooks on the local machine.
#
# Git hooks are not installed by `git clone` and cannot be auto-activated by a
# committed file alone. This points git at the repo-tracked .githooks/ directory
# by setting core.hooksPath, so the hooks in version control actually run.
# Re-run after a fresh clone. Idempotent.
#
# Works for worktrees too: core.hooksPath is set as a relative path, so each
# worktree resolves it against its own checked-out .githooks/ copy.
#
# On Windows, run the equivalent from the repo root in any shell:
#   git config core.hooksPath .githooks
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

HOOKS_DIR=".githooks"
[ -d "$HOOKS_DIR" ] || { echo "ERROR: $REPO_ROOT/$HOOKS_DIR not found." >&2; exit 1; }

# Ensure hooks are executable (matters on Linux/macOS; harmless on Windows).
chmod +x "$HOOKS_DIR"/* 2>/dev/null || true

git config core.hooksPath "$HOOKS_DIR"

echo "Installed git hooks: core.hooksPath -> $HOOKS_DIR"
echo "Active hooks:"
for h in "$HOOKS_DIR"/*; do
  [ -f "$h" ] || continue
  case "$(basename "$h")" in
    *.md|*.sample) continue ;;
  esac
  echo "  - $(basename "$h")"
done
echo "Done. The pre-push guards (PR-state + LEARNINGS cap + optional tests) are now active."
