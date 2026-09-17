---
name: "RPC: Comment"
summary: "Returns one comment as the API read model, given its id (uid/tsid) or a version CID."
schemaDefinition: ipfs://bafyreiero5xgharu67e574hkkcpmeeyobx5sivj4vhygsditvbpkqsdubu
---
Fetches one comment by id or version CID. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:iF3gr7CN -->

This page describes the **rpc/comment** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:kND-xRJl -->

# Shape <!-- id:OHMUY0Pe -->

A **closed struct** with these fields: <!-- id:gjgJsWAB -->
  - `key` _(required)_ — `"Comment"` <!-- id:sgUIu7Zp -->
  - `input` _(required)_ — [string](../string.md) <!-- id:TEXCgfQs -->
  - `output` _(required)_ — [rpc/type/comment](./type/comment.md) <!-- id:9BhGxGzo -->

# Depends on <!-- id:xwY-oZ3c -->

- [string](../string.md) <!-- id:BEyrCqg4 -->
- [rpc/type/comment](./type/comment.md) <!-- id:gF5PMV1e -->
