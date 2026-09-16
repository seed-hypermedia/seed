---
name: "RPC: Query"
summary: "Runs a document query (the same shape a Query block embeds). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field typ"
schemaDefinition: ipfs://bafyreihsgf5tz26q6k67sd7cvgpemrrwmpk5relwuc467x2rpj4oprwgy4
---
Runs a document query (the same shape a Query block embeds). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:ikOICZ5G -->

This document describes the **rpc/query** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:ci5mADgR -->

# Shape <!-- id:iirT7bVv -->

A **closed struct** with these fields: <!-- id:BqgxY2nD -->
  - `key` _(required)_ — `"Query"` <!-- id:LqFcY9h4 -->
  - `input` _(required)_ — [query](../query.md) <!-- id:3CteGWBj -->
  - `output` _(required)_ — one of [rpc/type/query-result](./type/query-result.md) | [null](../null.md) <!-- id:e3b637gr -->

# Depends on <!-- id:6QyI0lnv -->

- [query](../query.md) <!-- id:vBboMmrJ -->
- [null](../null.md) <!-- id:BVB9w3KD -->
- [rpc/type/query-result](./type/query-result.md) <!-- id:_MQGXI7B -->
