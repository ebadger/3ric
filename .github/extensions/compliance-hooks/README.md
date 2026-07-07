# compliance-hooks — governance-as-code

A Copilot CLI **extension** that makes this project's operating rules mechanical
instead of relying on the agent (or a human) to remember them. It injects the right
checklist at the right moment and hard-blocks the two most expensive mistakes.

> Pairs with `.githooks/pre-push` (which enforces the same rules at the git layer,
> for *any* caller). The extension catches things earlier, inside the agent loop;
> the git hook is the backstop that fires even outside Copilot CLI.

## What it does

| Moment | Hook | Behaviour |
|--------|------|-----------|
| Session start | `onSessionStart` | Injects `instructions/onsessionstart.md` (mandatory reading + core rules). |
| Feature-request prompt | `onUserPromptSubmitted` | "Which layers does this touch?" nudge. |
| About to `gh pr merge` | `onPreToolUse` | **HARD STOP** — never self-merge (except the `docs/learnings/` markdown auto-merge). |
| About to `git commit` | `onPreToolUse` | One-line commit checklist. |
| `create_pull_request` | `onPreToolUse` | Full PR checklist (`instructions/pr-checklist.md`). |
| About to `git push` | `onPreToolUse` | **Denies** the push if the branch's PR is MERGED/CLOSED; else injects `git-push.md`. |
| Edited a layer file | `onPostToolUse` | Cross-layer verification (`onposttooluse.md`), once per turn. |
| After `git fetch/pull/reset` | `onPostToolUse` | Re-read changed instruction files. |
| `git push` failed | `onPostToolUseFailure` | Hints the merged-branch cause + recovery steps. |

The prompt text lives in `.github/instructions/*.md` — edit those to change wording
without touching code.

## Install / activate

Copilot CLI auto-discovers `extension.mjs` under `.github/extensions/*/`. No build
step, no manifest. Reload after editing with the runtime's "reload extensions"
action (or restart the session).

## Customize for your project

- **`SPEC_PATTERNS`** in `extension.mjs` — the regexes that decide a "layer file" was
  edited (triggers the cross-layer check). Point them at your data-store / API /
  client directories.
- **`featureKeywords`** — words that trigger the "which layers?" nudge.
- **Tool names** — the shell-detection covers `powershell`, `bash`, and `shell`. Trim
  to your environment if desired.
- **Owner/handle references** were stamped to `ebadger` at instantiation — no action needed.

## Honest scope

This is a **nudge + two hard blocks**, not a sandbox. The hard blocks (self-merge,
push-to-merged-PR) are real denials; everything else is injected context the agent
is expected to honor. The git `pre-push` hook is the non-agent backstop. Neither
prevents a determined override — they prevent the *forgetful* mistake, which is the
common one.
