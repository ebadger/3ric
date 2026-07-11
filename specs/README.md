# Specs (`specs/`)

**Specs are the source of truth. Code follows specs, not the other way around.**

This is the single most load-bearing convention in the whole operating model: every
stored-data feature is specified across *all* the layers it touches **before** it is built,
and the spec is updated **in the same commit** as the code. That is what keeps an AI
workforce — which has no persistent memory between sessions — from drifting.

## How specs are organized

- `SYSTEM.md` — the **umbrella**: a short overview of the whole system that links to every
  sub-spec. Start here; read sub-specs lazily.
- One sub-spec **per layer** (copy `_TEMPLATE.md`). A typical set:
  - `DATABASE.md` — data store: schema, constraints, indexes, migrations.
  - `API.md` — endpoints, request/response contracts, validation, auth.
  - `WEB-CLIENT.md` — client/UI: pages, components, interactions, caching.
  - (add more layers as your architecture requires)

## The rules (canonical in `docs/LEARNINGS.md` §1–4)

1. **Layer checklist.** Before committing, verify every layer the change could touch.
2. **Data flow, not documents.** Specify every link:
   `User action → request → server logic → write → read → response → render`.
3. **Specs before code.** Update the spec first; code implements the spec.
4. **Commit atomically.** A feature spanning multiple specs/layers updates them all in one
   commit, so history is consistent at every point.

After implementing, update the **Implementation Status** section of the relevant sub-spec.

> The `compliance-hooks` extension nudges a cross-layer check whenever you edit a file that
> looks like a layer/spec file (see `.github/extensions/compliance-hooks/`).
