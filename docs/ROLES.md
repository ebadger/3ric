# 3ric — Roles: Lenses & Gates

> The main session does the work. The agents below are **lenses** you consult for
> specialist judgment, not a corporate hierarchy you route paperwork through.
> **ebadger is the CEO and final authority on everything.** Keep the org machinery small
> so the mission stays in front of the process.

---

## Lenses (consult for judgment)

Consult a lens when the decision lives squarely in its domain and a wrong call is
expensive. For routine implementation, just do the work and cite the relevant spec.
Build these out from `.github/agents/template-lens-agent.md` **as the project needs
them** — not all at once. A typical roster (rename/cut to fit your domain):

| Lens | Consult for | Don't consult for |
|------|-------------|-------------------|
| **Architecture & Engineering** | System architecture, cross-layer consistency, schema & API contracts, security, performance, major refactors, client/UX architecture | Isolated bug fixes, small copy, docs-only edits |
| **Product & Strategy** | What to build next and why, specs, prioritization, mission alignment, roadmap, business model | Pure technical decisions with no product impact |
| **Build & Operations** | Build pipeline, deploy, infra, migration execution, service health, observability, prod ops | Feature design, architecture, product calls |
| **Domain Expert** | The deep domain knowledge your product depends on being correct | Infra, deployment, software architecture |
| **Process & Learning** | Retrospectives & failure-pattern capture, knowledge curation, org/process design, **CEO coaching for ebadger**. Runs as a **periodic** review, not a per-task gate | Implementation, deployment, feature/architecture decisions |

---

## The code-review panel (mechanical reviewers, not lenses)

Two **model-diverse** reviewers run **by rule** before any code PR is published. Unlike
the lenses, they are a standing **gate input** on every code change, and exist purely to
break the primary model's single-model blind spots.

| Reviewer | Vendor | File |
|----------|--------|------|
| **GPT Reviewer** | (non-Claude) | `.github/agents/gpt-reviewer.md` |
| **Gemini Reviewer** | (third vendor) | `.github/agents/gemini-reviewer.md` |

They are **structurally read-only** (`tools: ["read","search"]`) and have no decision
authority: they return ranked findings + a verdict, the primary agent triages, **ebadger
merges.** Full procedure: `docs/CODE-REVIEW-PANEL.md`.

---

## The gates (mechanical, non-negotiable)

These are the rules that actually protect the mission. They are enforced by hooks /
scripts where possible, not by memory.

1. **Never self-merge.** Every change lands as a PR ebadger reviews and merges. The only
   exceptions are the markdown-only auto-merge paths in `docs/LEARNINGS.md §5`.
   Enforced by the `compliance-hooks` extension (hard stop on `gh pr merge`).
2. **Specs before code; trace every layer.** A stored-data change updates every affected
   layer (and its spec) in one atomic commit.
3. **Check PR state before pushing**; a merged branch is dead. Backed by
   `.githooks/pre-push` and the `compliance-hooks` push block.
4. **Capped Tier-1 memory.** `docs/LEARNINGS.md` stays under its token cap. Enforced by
   `pre-push` (`check-learnings-budget.sh`).
5. **Critical-path test gate.** Any change to the cash-/safety-/data-critical path must
   pass the project's eval/test suite before it ships. Wire it into
   `scripts/dev/pre-push-tests.sh` (see the `.example`).
6. **Mission clock > org clock.** Do **not** create net-new org/process artifacts (new
   agents, protocols, ceremonies, meta-docs) while the product has unmet, higher-priority
   needs. Fix the product first. Streamlining or **deleting** org machinery is always
   allowed; **adding** it waits.
7. **Self-modification needs ebadger.** Any change to agent authority, role boundaries, or
   this operating model requires ebadger's explicit approval. Agents propose; they never
   self-approve.

---

## Interaction protocol (condensed)

- **Disagreement →** surface it, summarize the trade-offs, present options (not a hidden
  decision), and let ebadger decide.
- **Handoff →** reference the specific commit/PR/issue, state what's expected, and the
  receiver acknowledges with results.
- **Bug triage →** GitHub Issues (see `.github/ISSUE_TEMPLATE/`); critical-path issues get
  a fast lane and a stricter review gate.

---

## A note on right-sizing

This file describes the *full* shape an AI-run project's org can take. **Start smaller.**
A new project often needs only: the gates above, the two reviewers, and one or two lenses.
Add lenses when a real, recurring class of expensive decision justifies one — and let the
**mission-clock gate (#6)** stop you from building org machinery faster than the product
earns it.
