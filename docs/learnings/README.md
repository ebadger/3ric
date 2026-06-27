# 3RIC — Learning Log System

> Progressive generalization: raw session learnings → weekly patterns → monthly strategy →
> `LEARNINGS.md` promotions. The mechanism that turns mistakes into durable, *capped* rules.

---

## Directory Structure

```
docs/learnings/
├── README.md          ← This file (format spec + lifecycle rules)
├── sessions/          ← Per-session learning files (daily capture)
├── weekly/            ← Weekly digest synthesizing patterns across sessions
├── monthly/           ← Monthly summary for strategic generalization
└── archive/           ← Retired files + pre-distillation narrative snapshots
```

---

## Session Learning File Format

**File naming:** `YYYY-MM-DD-session-name-slug.md`
**Location:** `docs/learnings/sessions/`

```markdown
# Session Learning — [Session Name]

**Date:** YYYY-MM-DD
**Session ID:** [short ID or slug]
**Duration:** ~X hours
**Agent(s):** [comma-separated roles]
**Branch(es):** [branch name(s)]

## What Happened

[1-3 sentences: what was the goal and what actually occurred]

## Learnings

### L1: [Learning Title]

**Cost:** [Quantified: "~45 minutes of rework", "opened a fresh PR", "stale binary 30 min"]
**What happened:** [Concrete description of the failure or surprise]
**Why it happened:** [Root cause, not just symptoms]
**Rule:** `[Concrete behavioral imperative — start with an action verb]`

### L2: [Next Learning Title]

...repeat for each learning...

## What Worked Well

- [Thing that saved time or worked better than expected]

## Promotion Candidates

- [ ] L1 ready for `LEARNINGS.md` — [reason]
- [ ] L2 needs one more occurrence before promotion
```

---

## Quality Criteria

Only capture learnings that meet **at least one** of these bars:

1. **Time cost:** Would have saved >15 minutes if known in advance
2. **Rework cost:** Caused a commit, PR, or deploy to be redone
3. **Risk cost:** Could have broken prod or caused data/money loss
4. **Repeatability:** Same mistake happened before (even once)

**Skip sessions** where all work was routine with no surprises, errors, or detours.

Every learning MUST have a quantified **Cost** and a concrete **Rule** that starts with an
action verb.

---

## Lifecycle

1. **Daily capture** — a process/learning agent (or the session itself) writes `sessions/` files.
2. **Weekly digest** — synthesize patterns across sessions into `weekly/`.
3. **Monthly summary** — generalize patterns into strategic guidance in `monthly/`.
4. **Promotion** — high-signal items promoted to `docs/LEARNINGS.md`.

### Promotion budget (priority-based distillation)

`docs/LEARNINGS.md` is the **always-loaded Tier-1 rules digest** — it enters the model's
context at the start of every session. To stop it from crowding out task context, it has a
**hard cap of ~2,500 tokens** (a `pre-push` guard, `scripts/dev/check-learnings-budget.sh`,
enforces it).

Promotion is therefore **competitive, not additive**:

- Distill each promoted item to **rule-shape** (≤ ~3–5 lines): the rule + a one-line WHY +
  (when a deep dive matters) a link back to the `sessions/` or `archive/` narrative.
- If a new rule would breach the cap, that is the **trigger to first dedup/merge** existing
  rules covering the same ground; if still over, **demote** the lowest-value rule's detail
  back to the archive. Never just grow the file.
- **What earns a slot:** recurrence (≥2×), money/data-loss/safety risk, cross-layer/contract
  breakage, or high time/rework cost. One-off or cosmetic trivia stays here only.
- **Never strip the WHY.** Distillation removes the long narrative, never the context.
- Promotion edits to `docs/LEARNINGS.md` require **ebadger's approval** (excluded from auto-merge).

---

## Auto-Merge Rules

Learning PRs may be auto-merged **only** when they touch learning markdown alone:

- ✅ Only `.md` files under `docs/learnings/sessions/`, `weekly/`, `monthly/`, or `archive/`
- ✅ No code, spec, config, or other path changes in the same commit
- ❌ Mixed commits → create a normal PR, do NOT auto-merge
- ❌ `docs/learnings/README.md` changes → normal PR only
- ❌ `docs/LEARNINGS.md` promotions → normal PR only (require ebadger's approval)

This scope matches `docs/LEARNINGS.md` Workflow Rule §5.
