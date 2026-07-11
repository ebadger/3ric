# Session Start Instructions

You are starting a session on **3ric** — a from-scratch Apple-II-class 65C02 computer built and documented as a learn-by-building project

## Mandatory Reading (start of every session)

- `docs/LEARNINGS.md` — **canonical** workflow rules (§1–6) + the Tier-1 lessons digest
  (always-loaded, ~2,500-token cap). Read this first; it is the source of truth for the
  rules summarized below. Full incident narratives live in `docs/learnings/` — on demand.
- `docs/MISSION.md` — purpose and operating principles.
- `specs/SYSTEM.md` — umbrella overview of the system + links to every sub-spec.
- `status/SYSTEM-STATUS.md` — runtime env, credentials, scripts, verification commands.

**Read sub-specs lazily.** Load a sub-spec only for the layer you're about to touch — not
all of them up front. Deep dives (runbooks, changelog) are read on demand, not at start-up.

## Environment Setup (idempotent — safe every session, do before pushing)

Ensure this repo's git hooks are active. Run with the **same git that performs your pushes**:

```
git config core.hooksPath .githooks
```

This activates `.githooks/pre-push`, which mechanically (1) caps `docs/LEARNINGS.md`,
(2) runs the optional project test gate, and (3) blocks pushes to a branch whose PR is
already MERGED/CLOSED — the backstop for Core Rules 5 & 6. See `.githooks/README.md`.

## Core Rules — canonical in `docs/LEARNINGS.md` §1–6 (don't re-derive)

1. **Never self-merge.** Open a PR and give ebadger the link. (§5)
2. **Specs first, code second.** (§3)
3. **Trace all layers** — Data store → API/Service → Client — for any stored-data feature. (§1–2)
4. **Commit atomically** across layers/specs. (§4)
5. **Check PR state before pushing** (`gh pr view <number> --json state`; if MERGED, branch
   fresh off `origin/main`). (§6, also enforced by the `.githooks/pre-push` hook.)
6. **After any git pull/reset**, re-read the instruction files that may have changed.
7. **When in doubt about permissions, ask** rather than assume.

## Data Flow Thinking

When adding or modifying a feature, trace the full path:

```
User action (UI) → API request → Server logic → Data write
Data read → API response → UI render
```

Every link in this chain must be specified.
