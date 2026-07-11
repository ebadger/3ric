# PR Checklist

Before creating a PR, verify:

1. **PR status** — `gh pr view <N> --json state` → must be OPEN (if updating). If MERGED/CLOSED, branch from `origin/main` and open fresh.
2. **Upstream synced** — `git fetch origin main` done.
3. **Never self-merge** — Provide ebadger the PR link. Do not merge.
4. **All layers covered** — Data store / API / Client all updated if affected.
5. **Spec status marked** — Implementation status updated in the relevant spec.
6. **Tests pass** — All tests confirmed green.
7. **Status document** — If your changes affect runtime behavior (new endpoints, credentials, ports, scripts, schema changes, new services), update `status/SYSTEM-STATUS.md`.
8. **Second-model review (code/config PRs)** — For any PR that can change product or agent behaviour (application code, `specs/**`, schema/migrations, API contracts, client, config, build/deploy, or `.github/agents`·`.github/instructions`·hooks), run **both** independent reviewers on the diff (passing the `model` param explicitly), triage every finding (fix or record why-not), add the **## Second-model review** block to the PR body, and post the reviewers' verbatim output + a per-model `Scorecard` line as a PR comment. Non-product prose / comment-only / typo PRs are exempt. See `docs/CODE-REVIEW-PANEL.md`.
