---
name: "RPC: QueryBlock"
summary: "Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input`"
schemaDefinition: ipfs://bafyreicjc4wwp6x45pylwfxrvdv33fbaw5y6yoohnfq6cqij2wmnu6qai4
---
Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:9vWOoz-M -->

This document describes the **seed-rpc-query-block** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:0Yk-OOw5 -->

# Shape <!-- id:rSSzXiwR -->

A **closed struct** with these fields: <!-- id:MNSUcwUS -->
  - `key` _(required)_ — `string` enum: `QueryBlock` <!-- id:tvvO2-wp -->
  - `input` _(required)_ — map { 1 fields } <!-- id:tJWuR30d -->
  - `output` _(required)_ — one of [seed-query-block-payload](./seed-query-block-payload.md) | [null](./onyx-null.md) <!-- id:VSpP7fZ1 -->

# Depends on <!-- id:I9m0maUM -->

- [hypermedia-query](./hypermedia-query.md) <!-- id:wzF0tC6g -->
- [null](./onyx-null.md) <!-- id:2IhT75Lz -->
- [seed-query-block-payload](./seed-query-block-payload.md) <!-- id:K45Wipex -->
