# Merge Block

**You must NEVER run `gh pr merge` except for the `docs/learnings/` markdown auto-merge.**

## Rule (LEARNINGS.md §5)

All PRs require ebadger's approval to merge. Your job is to:
1. Create the PR
2. Provide the link to ebadger
3. Stop and wait

## Only Exception

`docs/learnings/` markdown-only changes may be self-merged per the auto-merge protocol:
- Branch contains ONLY `.md` files under `docs/learnings/sessions/`, `weekly/`, `monthly/`, or `archive/`
- No code, spec, config, or other path changes in the same commit
- PR is created with base: main
- Merged via `gh pr merge <N> --merge --delete-branch`

(`docs/learnings/README.md` and `docs/LEARNINGS.md` promotions are NOT auto-mergeable.)

If the command you're about to run does NOT match this exception, **cancel it immediately**.
