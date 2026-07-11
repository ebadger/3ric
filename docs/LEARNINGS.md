# 3ric — Learnings (Rules Digest)

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
(e.g. 6502 ROM/software → Emulator VM core (C++) → Web bridge/WASM client, plus the codegen
platform-ref, the 22V10 GAL decode, and the umbrella spec) for impact. WHY: the memory map
and soft switches are a shared contract — missing one mirror silently breaks it.

**§2. Think in data flow, not documents.** Specify every link of
`keypress / soft-switch → CPU Step() → memory/device → framebuffer/serial → host → canvas`.

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

## Seed engineering rules (3ric — keep or prune as real learnings accrue)

- **Native and WASM builds must stay behavior-identical.** Shared VM/WozLib/SD sources may
  diverge only behind `__EMSCRIPTEN__`/`PLATFORM_WEB` guards; verify a core change in *both*
  the Windows build and `web/build.ps1` + `web/test_boot.cjs` before "done." WHY: the browser
  demo is the only build most people ever run.
- **The memory map is a cross-layer contract.** `vm.h` `MM_*` is mirrored by the 22V10 GAL,
  the web bridge, and `codegen/platform-ref.*`. Change one → update all in the same commit and
  regenerate the ref (`gen_platform_ref.mjs`). WHY: a silent map drift makes programs
  load/decode at the wrong address and fail only at runtime.
- **Never fake emulation output.** An unimplemented opcode/device/soft-switch must be
  observable (assert/log/explicit unimplemented), never a plausible-looking fake value. WHY:
  fabricated results look identical to a working feature and hide the gap.
- **Prove 6502/CPU changes on the emulator, not by reading code.** Run the relevant
  `Badger6502VMTest` cases and/or a `run6502.mjs` check with an explicit expected
  serial/screen/halt before shipping. WHY: instruction/flag bugs are invisible in review and
  surface only as wrong program behavior.
- **A documented-but-unbuilt opcode/routine is a tracked gap, not a feature.** Record it in
  the layer spec's Implementation Status and make the emulator surface it explicitly.

---

## Project-specific clusters (fill these in)

> Add topic-clustered rules here as the project earns them — e.g. `## Emulation accuracy`,
> `## WASM/native parity`, `## Build & deploy (Pages)`. New learnings merge into the relevant
> cluster **under the cap**. See `docs/learnings/README.md` for the capture → distill → promote flow.

---

*Topic-clustered and priority-distilled, not chronological — new learnings merge into the
relevant cluster under the cap (see "How this file is maintained").*
