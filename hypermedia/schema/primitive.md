---
name: Primitive
summary: 'one of the standard-library schemas `schema/<kind>.schema.json`, each exactly `{ "type": <kind> }` (e.g.'
---
**Primitive** — one of the standard-library schemas `schema/<kind>.schema.json`, each exactly `{ "type": <kind> }` (e.g. `schema/string`, `schema/boolean`). The canonical, content-addressed block for a kind; reference it (`{ "ref": "schema/string" }`) instead of inlining a type. An _instance_ of the meta-schema — not to be confused with a **variant**, which is a _shape_ the meta-schema is a union of. ([the data model](./data-model.md)) <!-- id:3HfWQq4T -->
