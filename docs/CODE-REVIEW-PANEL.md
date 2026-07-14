# Code-Review Panel — Multi-Model PR Review (mandatory for code PRs)

> **Why this exists.** Every line of product code is written by one model family (the
> primary engineering agent). A single model has consistent blind spots. Before a code
> change ships, two reviewers running on **different model families** challenge it, so a
> defect the primary can't see has two more chances to get caught. This is cheap
> insurance on the thing you can't afford to get wrong: your critical path.

## The two reviewers

| Agent | File | Vendor |
|-------|------|--------|
| **GPT Reviewer** (`gpt-reviewer`) | `.github/agents/gpt-reviewer.md` | a strong non-primary vendor |
| **Gemini Reviewer** (`gemini-reviewer`) | `.github/agents/gemini-reviewer.md` | a strong third vendor |

Both are **pinned** to their model via the `model:` frontmatter key and **structurally
read-only** (`tools: ["read","search"]` — no `edit`, no shell). They return findings; they
never touch code and never merge.

**Guaranteeing the model pin.** The `model:` frontmatter is the documented way to bind an
agent to a model, but to stay safe against any invocation path that ignores it, when the
primary agent invokes a reviewer via the `task` tool it **MUST also pass the `model`
parameter explicitly**. Belt and suspenders: never let a reviewer silently fall back to
the primary model — that would destroy the model diversity this whole procedure buys.

## The rule (mandatory)

**Before publishing a PR that contains code, the primary agent MUST:**

1. Finish a complete draft implementation (reviewers need a real diff, not a plan).
2. Invoke **both** reviewers on the diff, **passing the `model` parameter explicitly**.
   - The reviewers have **no shell**, so **paste the diff (and point them at the relevant
     spec + tests)** in the prompt.
   - Do **not** feed them your own justification — independence is the point.
3. **Triage every finding.** For each one, either **fix it** or **record a one-line
   reason** for not fixing (e.g. "false positive — X is validated upstream at Y").
   - **Reviewers can be wrong too** — verify a claimed bug against ground truth (the spec,
     the schema, the actual API) and **override with a cited reason** when they're mistaken.
   - **Apply the review-cost gate before editing:** escalate every **BLOCK**, regardless of
     cost, and any non-blocking finding the primary recommends fixing when the projected
     end-to-end engineering cost is **more than one minute**. Give ebadger all proposed
     options, an estimate for each (implementation, validation, and required re-review), and
     the primary's recommendation; wait for the decision. Sub-minute non-blocking fixes may
     proceed autonomously.
   - **If your fixes change the diff materially, re-run both reviewers** until they raise
     no new BLOCK/HIGH findings. The diff you ship must be the diff that was reviewed.
4. **Record the summary in the PR body** (format below) so the review is visible at a glance.
5. **Open the PR** for ebadger.
6. **Post the persistent record as a PR comment.** Post each reviewer's **verbatim** output
   plus your **per-finding tags** (`gh pr comment <N> --body ...`). This is the durable,
   GitHub-native record ebadger reads. The reviewers stay read-only — the primary agent
   posts on their behalf; never give the reviewer agents GitHub write access.

### Scope — what triggers the panel

**Triggers** (panel required): any PR touching application code, **specs** (`specs/**` —
even though Markdown), schema/migrations, API contracts, the client, config, the
build/deploy path, or **behaviour-defining config** such as `.github/agents/*.md`,
`.github/instructions/*.md`, and the compliance hooks. In-scope if it can alter how the
product or the agents behave — regardless of file extension.

**Exempt** (panel optional): non-product **prose** with no behavioural effect — narrative
docs, `status/`, `README`, `CHANGELOG`, and comment-only or typo fixes. Don't burn two
model reviews on a typo. **When in doubt, run the panel.**

### Disagreement protocol

- Escalate **every BLOCK before making a review-driven code change**. Include fix/punt/
  override options, end-to-end estimates, and the primary's recommendation. If the primary
  disagrees with the finding, include one evidence-backed rebuttal; ebadger makes the call.
  Do not silently override a BLOCK or loop the reviewers indefinitely.
- If the two reviewers disagree with each other, treat the stricter finding as the default
  and note the split for ebadger.

### PR body record format

```
## Second-model review
- Reviewed diff: `<merge-base-sha>...<HEAD-sha>`
- GPT Reviewer (<model>): <verdict> — <N> findings
- Gemini Reviewer (<model>): <verdict> — <N> findings
- Resolved: <M> fixed, <K> overridden
  - Overridden: <finding> — <reason>
```

### Persistent review record + model scorecard (PR comment)

After opening the PR, post the reviewers' **verbatim** output and **tag every finding**:

~~~
### GPT Reviewer (<model>) — verdict: <verdict>
1. [HIGH] <finding, verbatim> — accepted · true-positive · fixed (<commit/where>)
2. [MEDIUM] <finding, verbatim> — overridden · false-positive · <cited reason>
...
Scorecard — <model>: findings <N> | true-positive <T> | false-positive <F> | led-to-fix <X>
~~~

Tag vocabulary per finding: **accepted / overridden** (did you act?), **true-positive /
false-positive** (was it real?), **led-to-fix y/n** (did it change shipped code?).

Because every PR carries a `Scorecard` line on GitHub, **the evaluation needs no separate
database** — a periodic review harvests scorecards across merged PRs (`gh pr list` /
`gh api`) and tallies true-positive vs false-positive and bugs-caught per model. **Don't
build an eval harness or dashboard yet** — let the scorecards accumulate first.

**Honest caveat — grading bias.** The primary agent scores the very reviewers whose job is
to challenge it. Guards: every `false-positive`/`overridden` needs a **cited, checkable
reason**; ebadger spot-checks at merge; and the metric to trust most is the hard-to-game
one — **material bugs caught that were actually fixed** — not subjective "usefulness."

## Enforcement & honesty about it

Enforced as a **rule + advisory nudge**, not a hard mechanical block:
`.github/instructions/pr-checklist.md` reminds the agent at PR-creation time (the nudge
fires on the **`create_pull_request` tool** — create PRs that way, not via `gh pr create`,
or the reminder is skipped), and ebadger can refuse to merge a code PR with no review
record. A brittle "Reviewed-by line present?" gate is easy to satisfy with theatre; if the
panel proves its worth, a hard gate can come later.

## Kill criterion (this must earn its keep)

This is net-new process machinery, which the mission-clock rule tells us to resist. It is
justified only if it catches real defects. **Review at 30–60 days:** if the panel has not
caught a material issue the primary missed, **slim or delete it.**

## Changing the models

Edit the `model:` line in each agent file. Use the latest strong reviewer from each
vendor. Keep the two reviewers on **different vendors** — that diversity is the entire value.
