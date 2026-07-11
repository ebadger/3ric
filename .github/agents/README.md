# Agents (`.github/agents/`)

Custom agents are **specialist lenses** you consult for judgment in their domain —
not a hierarchy you route paperwork through. The main session does the work; agents
sharpen specific decisions. **ebadger is the final authority on everything.**

See `docs/ROLES.md` for the lenses-and-gates org model and `docs/CODE-REVIEW-PANEL.md`
for the review-panel procedure.

## What's here

| File | Purpose |
|------|---------|
| `template-agent.md` | Minimal agent skeleton + the reusable **anti-sycophancy core**. Start here for any new agent. |
| `template-lens-agent.md` | Richer "C-suite lens" skeleton (Identity → Expertise → Decision Authority → Anti-Patterns). Use for a standing specialist advisor. |
| `gpt-reviewer.md` | Independent code reviewer, pinned to a strong **non-Claude** model. Ready to use. |
| `gemini-reviewer.md` | Independent code reviewer, pinned to a strong **third-vendor** model. Ready to use. |

## The two valuable, reusable ideas

### 1. The anti-sycophancy core
The `## Patterns` block (identical on every agent) turns an agreeable assistant into a
colleague who will tell you you're wrong: claim-tagging (`[KNOWN]`/`[INFERRED]`/`[GUESS]`),
explicit confidence bands, "say 'I don't know' on the first line," and a self-audit of
broken rules. This is the single most portable, highest-value part of the template —
keep it on any agent whose job is judgment.

### 2. Model-diverse review as a standing gate
A single model family has consistent blind spots. The two reviewers run on **different
vendors** and are **structurally read-only** (`tools: ["read","search"]` — no edit, no
shell). Before a code PR ships, both review the diff; the primary agent triages every
finding (fix or cite a reason); ebadger merges. The diversity is the entire value — keep
the two reviewers on different vendors, and update the `model:` pins to the current best
models as they change.

## Adding a new agent

1. Copy `template-agent.md` (simple) or `template-lens-agent.md` (rich) to `your-agent.md`.
2. Fill in `name` and a sharp `description` — the description is what gets the agent
   invoked at the right time, so name the domain **and** what it must NOT be used for.
3. Keep the `## Patterns` anti-sycophancy block.
4. Narrow `tools:` to what the agent actually needs (read-only advisors get `["read","search"]`).
5. Merge to the default branch to make it available.

## Customize for your project

- Update reviewer `model:` pins to the current strongest model from each vendor.
- Build out your own lenses (e.g. Architecture, DevOps, Product, Domain-Expert,
  Process & Learning) from `template-lens-agent.md` as the project needs them — but heed
  the **mission-clock rule** in `docs/ROLES.md`: don't add org machinery faster than the
  product needs it.
