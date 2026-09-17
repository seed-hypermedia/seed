---
name: "RPC: QueryBlock"
summary: "Runs a Query block’s query and returns the results plus the per-item interaction summaries and author metadata its rendering needs, or null."
schemaDefinition: ipfs://bafyreiaulfxdzbw7rfuh356i6cwnq6obtcllzrtr7qkuozgf27u36i2ntq
---
Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:9vWOoz-M -->

This page describes the **rpc/query-block** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:0Yk-OOw5 -->

# Shape <!-- id:rSSzXiwR -->

A **closed struct** with these fields: <!-- id:MNSUcwUS -->
  - `key` _(required)_ — `"QueryBlock"` <!-- id:tvvO2-wp -->
  - `input` _(required)_ — map { 1 fields } <!-- id:tJWuR30d -->
  - `output` _(required)_ — one of [rpc/type/query-block-payload](./type/query-block-payload.md) | [null](../null.md) <!-- id:VSpP7fZ1 -->

# Depends on <!-- id:I9m0maUM -->

- [query](../query.md) <!-- id:wzF0tC6g -->
- [null](../null.md) <!-- id:2IhT75Lz -->
- [rpc/type/query-block-payload](./type/query-block-payload.md) <!-- id:K45Wipex -->
