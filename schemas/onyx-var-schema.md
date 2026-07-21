---
name: "Variable schema"
summary: "A type-variable reference: matches whatever a generic's parameter is bound to. Written { \"var\": \"<name>\" }."
---

# Variable schema

A type-variable reference: matches whatever a generic's parameter is bound to. Written { "var": "<name>" }.


This document describes the **onyx-var-schema** type — a meta-schema variant. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `var` *(required)* — `string`
- `name` — `string`
- `description` — `string`
