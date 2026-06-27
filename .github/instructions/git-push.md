# Git Push — Pre-Push Verification

> **Mechanical enforcement:** a repo-tracked `pre-push` hook (`.githooks/pre-push`)
> blocks pushes to a branch whose PR is MERGED/CLOSED. Activate it once per clone with
> `scripts/dev/install-hooks.sh`. The checks below are still your responsibility — the
> hook is a backstop, not a substitute (it fails open when `gh` is unavailable, and can
> be bypassed with `SKIP_PR_GUARD=1`).

⚠️ You are about to push commits. Before proceeding, you MUST verify:

## Mandatory Checks

1. **PR state** — Run `gh pr view <N> --json state` for the associated PR.
   - If **OPEN**: proceed with push.
   - If **MERGED**: STOP. Do not push. Create a new branch from `origin/main`, cherry-pick your commits, and open a fresh PR.
   - If **CLOSED**: STOP. Ask ebadger how to proceed.
   - If **no PR exists yet**: this is a first push — proceed, then create a PR.

2. **Upstream synced** — Run `git fetch origin main` before pushing to confirm you're not behind.

3. **Branch matches PR** — Confirm you're pushing to the same branch the open PR tracks. Do not push to a branch whose PR was already merged.

## Why This Matters

Pushing to a merged branch is a no-op — the commits go nowhere useful. They orphan your work and require manual cleanup (cherry-picks, new PRs, confusion). This is a recurring footgun (see LEARNINGS.md §6).

## If You Already Pushed to a Merged Branch

1. `git fetch origin main`
2. `git reset --hard origin/main`
3. `git cherry-pick <your orphaned commit SHAs>`
4. Push to a new branch and open a fresh PR.
