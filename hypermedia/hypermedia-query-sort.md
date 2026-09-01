---
name: "Query sort"
summary: "One sort term for a Query block's results, optionally reversed."
---

# Query sort

One sort term for a Query block's results, optionally reversed.


This document describes the **hypermedia-query-sort** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `reverse` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
- `term` *(required)* — `string` enum: `Path` `Title` `CreateTime` `UpdateTime` `DisplayTime` `ActivityTime`

## Depends on

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
