---
name: "Query"
summary: "A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Q"
---

# Query

A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Query API.


This document describes the **hypermedia-query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `includes` *(required)* — list of [hypermedia-query-inclusion](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-inclusion)
- `sort` — list of [hypermedia-query-sort](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-sort)
- `limit` — `integer`

## Depends on

- [hypermedia-query-inclusion](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-inclusion)
- [hypermedia-query-sort](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-sort)
