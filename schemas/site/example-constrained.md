---
name: "Constrained record"
summary: "Exercises the value constraints: string length + pattern, numeric bounds, and list size."
---

# Constrained record

Exercises the value constraints: string length + pattern, numeric bounds, and list size.


This document describes the **example-constrained** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `username` *(required)* — `string`
- `score` *(required)* — `integer`
- `tags` — list of [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)

## Depends on

- [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
