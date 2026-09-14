---
name: "RPC: QueryBlock"
summary: "Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input`"
schemaDefinition: ipfs://bafyreiauf7hrm3naq5tatyv26zk43bgpyht2c5zbunn2zkahgjcfesen5m
---
Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:9vWOoz-M -->

This document describes the **rpc/query-block** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:0Yk-OOw5 -->

# Shape <!-- id:rSSzXiwR -->

A **closed struct** with these fields: <!-- id:MNSUcwUS -->
  - `key` _(required)_ — `"QueryBlock"` <!-- id:tvvO2-wp -->
  - `input` _(required)_ — map { 1 fields } <!-- id:tJWuR30d -->
  - `output` _(required)_ — one of [rpc/type/query-block-payload](./type/query-block-payload.md) | [null](../schema/null.md) <!-- id:VSpP7fZ1 -->

# Depends on <!-- id:I9m0maUM -->

- [schema/query](../schema/query.md) <!-- id:wzF0tC6g -->
- [null](../schema/null.md) <!-- id:2IhT75Lz -->
- [rpc/type/query-block-payload](./type/query-block-payload.md) <!-- id:K45Wipex -->
