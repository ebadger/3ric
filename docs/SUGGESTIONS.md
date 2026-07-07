# 3RIC — Suggestions

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

*Add new suggestions at the bottom. ebadger promotes accepted ones into practice.*
