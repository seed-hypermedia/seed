---
name: "RPC: Comment"
summary: "Fetches one comment by id or version CID. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `"
schemaDefinition: ipfs://bafyreife2khl6gi7wdesrm4w2krtlh4amytefk32tptt5xwdc2wglyucwa
---
Fetches one comment by id or version CID. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:iF3gr7CN -->

This document describes the **seed-rpc-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kND-xRJl -->

# Shape <!-- id:OHMUY0Pe -->
A **closed struct** with these fields: <!-- id:gjgJsWAB -->
  - `key` _(required)_ — `string` enum: `Comment` <!-- id:sgUIu7Zp -->
  - `input` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:TEXCgfQs -->
  - `output` _(required)_ — [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:9BhGxGzo -->

# Depends on <!-- id:xwY-oZ3c -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:BEyrCqg4 -->
- [seed-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment) <!-- id:gF5PMV1e -->