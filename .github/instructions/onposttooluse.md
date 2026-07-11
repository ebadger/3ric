# Spec Edit — Cross-Layer Verification

You just edited a specification or source file in one of the system layers. Before proceeding, verify cross-layer consistency.

## Layer Checklist

Ask yourself for each (rename these to your project's actual layers):

- [ ] **Data store** (`specs/DATABASE.md`, schema/migrations) — Are schema, columns, constraints, or indexes affected?
- [ ] **API / Service** (`specs/API.md`, server endpoints) — Are endpoints, request/response shapes, or validation rules affected?
- [ ] **Client / UI** (`specs/WEB-CLIENT.md`, frontend) — Are pages, components, or interactions affected?
- [ ] **SYSTEM.md** (`specs/SYSTEM.md`) — Does the umbrella overview need updating?

## Rules

- If a change touches one layer, explicitly verify whether the others need updates before committing.
- Don't treat spec documents as independent — they are a connected system where changes propagate.
- Update implementation status in the relevant spec after implementing a feature.

## Common Mistakes

- Adding a data-store column but forgetting to expose it in the API response shape
- Adding an API endpoint but forgetting to update the client to call it
- Updating a spec but not updating its implementation-status section
