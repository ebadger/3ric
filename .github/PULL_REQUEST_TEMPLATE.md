## Summary

<!-- What does this PR do? One or two sentences. -->

## Checklist

<!-- Tick every item that applies. For items that genuinely don't apply, strike through with ~~strikethrough~~ and briefly note why. -->

- [ ] **Spec updated** — if this touches stored data, API shape, or client behaviour, the relevant spec under `specs/` is updated in this commit.
- [ ] **Migration included** — if the data schema changed, a migration is included and tested.
- [ ] **Contract verified** — field names, types, and casing match between the server contract and the client.
- [ ] **Tests pass** — existing tests pass; new behaviour is covered by at least one test.
- [ ] **Only relevant files staged** — no accidental config, build output, or unrelated changes.
- [ ] **Second-model review** — for code/spec/config PRs, both reviewers were run, findings triaged, and the review block added (see `docs/CODE-REVIEW-PANEL.md`). Prose/typo PRs are exempt.

## Second-model review

<!-- For code/spec/config PRs. Delete this section for exempt prose/typo PRs. -->
- Reviewed diff: `<merge-base-sha>...<HEAD-sha>`
- GPT Reviewer (`<model>`): <verdict> — <N> findings
- Gemini Reviewer (`<model>`): <verdict> — <N> findings
- Resolved: <M> fixed, <K> overridden
  - Overridden: <finding> — <reason>

## Related issues

<!-- Closes #XXX -->
