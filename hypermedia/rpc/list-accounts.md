---
name: "RPC: ListAccounts"
summary: "Lists all known accounts as metadata payloads. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pa"
schemaDefinition: ipfs://bafyreiczbl22fu5bjxblx5zacwi7fyoij35st5kwjlimhswfx4zqaf3irm
---
Lists all known accounts as metadata payloads. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:5KM-97Ry -->

This document describes the **rpc/list-accounts** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:DiytFRat -->

# Shape <!-- id:1w2fkBth -->

A **closed struct** with these fields: <!-- id:HtDCnuN6 -->
  - `key` _(required)_ — `"ListAccounts"` <!-- id:nrPBInN4 -->
  - `input` _(required)_ — one of map | [null](../null.md) <!-- id:rapKkCzO -->
  - `output` _(required)_ — map { 1 fields } <!-- id:0hkz1VKc -->

# Depends on <!-- id:bHnYGVgD -->

- [null](../null.md) <!-- id:QJ8U0HIB -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:_CB4100E -->
