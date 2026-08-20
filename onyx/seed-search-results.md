---
name: "Search results"
summary: "A page of search results with the query echoed back and a pagination token. A derived read model computed by the Seed daemon/API for clients — not a signed netw"
---

# Search results

A page of search results with the query echoed back and a pagination token. A derived read model computed by the Seed daemon/API for clients — not a signed network blob.


This document describes the **seed-search-results** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `entities` *(required)* — list of [seed-search-result-item](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-search-result-item)
- `searchQuery` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- `nextPageToken` *(required)* — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-search-result-item](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-search-result-item)
