---
name: "Query table config"
summary: "Persisted presentation settings for a Query block's Table view: which columns are visible and how wide they are."
---

# Query table config

Persisted presentation settings for a Query block's Table view: which columns are visible and how wide they are.


This document describes the **hypermedia-query-table-config** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `columns` *(required)* — list of map { 3 fields }

## Depends on

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
