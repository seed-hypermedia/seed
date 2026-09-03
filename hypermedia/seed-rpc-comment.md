---
name: "RPC: Comment"
summary: "Fetches one comment by id or version CID. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `"
schemaDefinition: ipfs://bafyreigbta7ia3laec4li77xhaj4cejbb2o24praq2cjlkhww4uiys4um4
---
Fetches one comment by id or version CID. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:iF3gr7CN -->

This document describes the **seed-rpc-comment** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kND-xRJl -->

# Shape <!-- id:OHMUY0Pe -->

A **closed struct** with these fields: <!-- id:gjgJsWAB -->
  - `key` _(required)_ — `string` enum: `Comment` <!-- id:sgUIu7Zp -->
  - `input` _(required)_ — [string](./onyx-string.md) <!-- id:TEXCgfQs -->
  - `output` _(required)_ — [seed-comment](./seed-comment.md) <!-- id:9BhGxGzo -->

# Depends on <!-- id:xwY-oZ3c -->

- [string](./onyx-string.md) <!-- id:BEyrCqg4 -->
- [seed-comment](./seed-comment.md) <!-- id:gF5PMV1e -->
