---
name: Primitive
summary: 'one of the standard-library schemas `<kind>.schema.json`, each exactly `{ "type": <kind> }` (e.g.'
---
**Primitive**: one of the standard-library schemas `<kind>.schema.json`, each exactly `{ "type": <kind> }` (e.g. `string`, `boolean`). The canonical, content-addressed block for a kind. Naming it is how a field says what it is — `{ "type": "hm://…/string" }` names the kind and references that block in one move, the same key that names any other schema. An _instance_ of the meta-schema — not to be confused with a **variant**, which is a _shape_ the meta-schema is a union of. ([the data model](./data-model.md)) <!-- id:3HfWQq4T -->
