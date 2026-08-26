---
name: "Character stats"
summary: "A character's attribute block — the object a character page links to from its `stats` field. Lives as its own DAG-CBOR blob (an `ipfs://` reference), so it can "
---

# Character stats

A character's attribute block — the object a character page links to from its `stats` field. Lives as its own DAG-CBOR blob (an `ipfs://` reference), so it can hold integers and enums that document metadata cannot.


This document describes the **example-stats** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `strength` *(required)* — `integer` (1–10)
- `intellect` *(required)* — `integer` (1–10)
- `charisma` *(required)* — `integer` (1–10)
- `alignment` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) (one of `lawful`, `neutral`, `chaotic`)
- `traits` — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
