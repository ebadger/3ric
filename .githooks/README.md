# Git hooks (`.githooks/`)

Repo-tracked git hooks. They are **not** active until you point git at this
directory (hooks can't be auto-installed by `git clone`):

```sh
scripts/dev/install-hooks.sh        # sets core.hooksPath=.githooks
# or, equivalently, from the repo root in any shell:
git config core.hooksPath .githooks
```

This sets local config in `.git/config`, so it applies to the whole repo
(including all worktrees on this machine). Run it once per clone.

## Hooks

### `pre-push`
Runs three independent guards on every `git push`. Each **fails open** where it
cannot run, so it never blocks legitimate or offline work.

**1. LEARNINGS.md size-cap guard** (via `scripts/dev/check-learnings-budget.sh`).
`docs/LEARNINGS.md` is loaded into the model's context at the start of every
session, so it is a capped **Tier-1 rules digest** (~2,500 tokens); detailed
narratives belong in `docs/learnings/`. The guard blocks a push when the file
exceeds the cap, forcing priority-based distillation instead of unbounded growth.
- Counts **real tokens** with `tiktoken` when available (`pip install tiktoken`);
  otherwise falls back to a dependency-free character proxy.
- Override deliberately with `SKIP_LEARNINGS_BUDGET=1 git push ...`.

**2. Optional project test gate** (via `scripts/dev/pre-push-tests.sh`, if present
and executable). Runs your stack's tests / critical-path eval before allowing the
push. Copy `scripts/dev/pre-push-tests.sh.example` to `pre-push-tests.sh` and fill
in the command. This keeps the *mechanism* (a mechanical test gate on push)
project-agnostic. The example shows both a skippable test run and a NON-bypassable
gate scoped to a critical path.

**3. PR-state guard.**
Blocks pushes to a branch whose PR is already **MERGED** or **CLOSED**. Once a PR
is merged its branch is stale; pushing more commits orphans them (the merged PR
never updates) — the recurring footgun documented in `docs/LEARNINGS.md` §6.
- Uses `gh pr list --head <branch> --state all` to look up PR state.
- Only ever blocks on a confirmed MERGED/CLOSED state with no competing OPEN PR.
- Override deliberately with `SKIP_PR_GUARD=1 git push ...`.
