# 3RIC — Learnings (Rules Digest)

> The always-loaded **Tier 1 rules digest**: durable rules + the one-line WHY that makes
> each correct. Full narratives live in `docs/learnings/`, read on demand.
>
> _This is a template seed. Replace the example rules below with your project's real,
> earned learnings as they accrue. **Keep the "How this file is maintained" section** —
> it is the mechanism that keeps this file small and high-signal forever._

---

## How this file is maintained

- **Tier 1, always loaded.** This is the compact digest injected into every session
  preamble. Detailed narratives live in `docs/learnings/`
  (`sessions/weekly/monthly/archive/`), read **on demand only**.
- **Hard cap: 2,500 tokens** (≈9,500 chars). A `pre-push` guard enforces it
  (`scripts/dev/check-learnings-budget.sh`).
- **Priority-based distillation.** Every new learning is distilled to rule-shape
  (≤ ~3–5 lines): the rule + a one-line WHY + (if a deep dive matters) an archive link.
  Adding a learning that would breach the cap is the TRIGGER to first **dedup/merge**
  existing rules; if still over, **demote** the lowest-value rule's detail to the
  archive. Never just grow the file.
- **What earns a slot** (align with `learnings/README.md` Quality Criteria): recurrence
  (same class of mistake ≥2×), money/data-loss/safety risk, cross-layer/contract
  breakage, or high time/rework cost. One-off cosmetic or context-specific trivia stays
  in the archive only.
- **Promotion requires ebadger's approval.** This file is excluded from the
  `docs/learnings/` auto-merge (see Workflow Rule §5).
- **Do not strip the WHY.** Distillation removes the long narrative, never the context
  that makes a rule correct.

---

## Workflow Rules (numbered — the canonical operating contract)

**§1. Layer checklist.** Before committing a change, verify every layer it could touch
(e.g. Hardware → ROMs → VM core → Hosts/Web → Disk, plus the umbrella spec) for impact. WHY:
missing one layer silently breaks the only path the data actually flows through.

**§2. Think in data flow, not documents.** Specify every link of
`User action → request → server logic → write → read → response → render`.

**§3. Specs before code.** Specs are the source of truth; code follows specs. Update the
spec in the same change.

**§4. Commit atomically across layers.** A feature spanning multiple specs/layers updates
them all in one commit so history is consistent at every point.

**§5. Never self-merge.** Always open a PR and give ebadger the link; merging is ebadger's
call. WHY: instruction files changed mid-session aren't in context until re-read — after
any `git reset --hard`/branch change re-read `LEARNINGS.md`, `MISSION.md`,
`copilot-instructions.md`. **Auto-merge exceptions** are narrow, markdown-only paths
(e.g. `docs/learnings/` per `learnings/README.md`); everything else needs a PR + approval.

**§6. Always check PR state before pushing.** `git fetch origin main` then
`gh pr view <n> --json state`; if **MERGED**, branch fresh off `origin/main`
and open a new PR. WHY: pushing to a merged branch orphans the commit. Backed by the
`.githooks/pre-push` guard (`scripts/dev/install-hooks.sh`); it **fails open** when `gh`
is unavailable and is overridable with `SKIP_PR_GUARD=1` — a backstop, not a replacement
for the check.

**Worktree hygiene.** Never `git checkout`/merge `main` from a session
worktree — branch off `origin/main`. Don't rely on `--delete-branch` in a
worktree; verify `gh pr view <n> --json state,mergedAt` before retrying, and delete
branches explicitly (`git branch -D` + `git push origin --delete`).

---

## Seed engineering rules (universal — keep or prune to taste)

- **A documented-but-unbuilt endpoint is a tracked gap, not a freebie.** Grep the client
  for hardcoded/demo data papering over it.
- **Frontends must NEVER fabricate domain data** for a missing endpoint — render an
  explicit empty/"not available" state. WHY: a `// demo` placeholder ships looking
  identical to a real feature. After finding one, grep ALL screens for mock-derived literals.
- **Service/unit tests do NOT prove an HTTP-contract feature works.** Do a **live
  end-to-end smoke through the real endpoints** against the real data store before "done."
- **Enforce critical invariants in TWO places:** an app-level guard *and* a store-level
  constraint (e.g. a unique index), plus a test proving the constraint actually blocks the
  violation.
- **"Passes on an in-memory/dev store but fails on the real one" is the default risk** for
  any constraint that lives only in the production schema. Test constraints against a real
  instance of your production engine.

---

## Project-specific clusters (fill these in)

> Add topic-clustered rules here as your project earns them — e.g. `## Data & money paths`,
> `## Frontend / caching`, `## Deploy / ops`. New learnings merge into the relevant cluster
> **under the cap**. See `docs/learnings/README.md` for the capture → distill → promote flow.

---

*Topic-clustered and priority-distilled, not chronological — new learnings merge into the
relevant cluster under the cap (see "How this file is maintained").*
