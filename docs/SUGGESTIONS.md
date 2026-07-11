# 3ric — Suggestions

> A place for agent-generated ideas to improve cooperation, productivity, and quality.
> ebadger reviews these periodically and promotes good ones into practice (usually into
> `docs/LEARNINGS.md` or `.github/copilot-instructions.md`).
>
> **Why this exists:** an AI workforce notices process friction constantly but has no
> standing channel to act on it. This is that channel — a low-friction funnel so good
> ideas accrete instead of evaporating at session end. Keep entries concrete:
> **Problem → Suggestion → (optional) Owner.**

---

## Format

```markdown
### N. Short title

**Problem:** What's wrong or missing, concretely.

**Suggestion:** The proposed change. Small and actionable beats grand.

**Owner:** (optional) which lens/agent would carry it.
```

---

## Seed suggestions (generic — keep, prune, or replace)

### 1. Session handoff protocol

**Problem:** When multiple sessions exist (build, deploy, feature work), they can step on
each other or miss context.

**Suggestion:** When one session creates work for another, reference the specific
commit/PR/issue; the receiving session acknowledges and reports back with results.

---

### 2. Periodic retrospective

**Problem:** Learnings accumulate but there's no structured time to review and act on them.

**Suggestion:** A weekly/per-milestone pass where the Process & Learning lens summarizes
recent `docs/learnings/` entries, evaluates this file's suggestions, and proposes ≤3
high-leverage changes. ebadger approves or rejects.

---

### 3. Test-before-PR as a hard rule

**Problem:** Changes can be merged without verification when the build/test environment
isn't wired into the flow.

**Suggestion:** Wire the project's test command into `scripts/dev/pre-push-tests.sh` so the
`pre-push` hook proves green before any push. If no test environment is available, flag the
PR clearly: "⚠️ Not test-verified — needs CI or manual test."

---

### 4. Lo-res render test hooks must halt with WAI, not BRK

**Problem:** A codegen program that renders to the lo-res page (`$0400-$07FF`) can't
be verified by a BRK-based test hook: `BRK` drops into the monitor, whose register
dump is emitted via COUT and scrolls/scribbles the shared text+lo-res page,
corrupting the field before the headless harness can decode it. Hit while converting
Life to lo-res (PR #21); Snake never saw it because it only decodes after a free run.

**Suggestion:** For any hook that must leave the lo-res/text page intact for decoding,
end it with `WAI` instead of `BRK` — the harness reports a clean `wai` halt
(`vm.waiting()`), and the monitor never runs. Keep `BRK` hooks for state that lives in
RAM buffers (e.g. `$4000/$5000`), which the dump doesn't touch. A full render also
overwrites every visible byte, so a render-then-`WAI` hook can even follow a prior
`BRK` hook and still decode cleanly.

**Owner:** codegen / test-harness.

---

*Add new suggestions at the bottom. ebadger promotes accepted ones into practice.*
