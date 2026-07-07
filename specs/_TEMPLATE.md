# 3RIC — {{LAYER_NAME}} Spec

> Copy this file to `specs/<LAYER>.md` (e.g. `DATABASE.md`, `API.md`, `WEB-CLIENT.md`) and
> fill it in. One sub-spec per layer. Keep it the source of truth — update it in the same
> commit as the code that implements it.

---

## Purpose

{{What this layer is responsible for, in one or two sentences.}}

## Contracts / Interfaces

{{The precise, checkable contract this layer exposes — table schemas, endpoint shapes,
component props, message formats. Field names, types, casing, nullability. This is what the
other layers depend on; changing it is a cross-layer event.}}

## Behaviour / Rules

{{Validation rules, invariants, edge cases, error states. Be explicit about what happens on
the unhappy path — empty states, failures, timeouts.}}

## Data flow

{{Trace the links this layer participates in:
`... → this layer → ...`. Name the upstream and downstream layers.}}

## Dependencies

- Upstream: {{what this layer reads/depends on}}
- Downstream: {{what depends on this layer}}

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| {{item}} | Not started / In progress / Shipped | {{PR #, caveats}} |

> Update this table after implementing. A documented-but-unbuilt item is a **tracked gap**,
> not a feature — and the client must render an explicit empty state for it, never fabricate
> data (see `docs/LEARNINGS.md`).
