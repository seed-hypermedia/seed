---
name: "RPC: ListEvents"
summary: "Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fi"
schemaDefinition: ipfs://bafyreid5kpy5i2bbwjlvwyvpnqpqgrs63ghhyr36kffsj3ecnf2srxzsua
---
Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:8NB6bWqQ -->

This document describes the **seed-rpc-list-events** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:CxLVzOd5 -->

# Shape <!-- id:kghUGbcO -->

A **closed struct** with these fields: <!-- id:1xYbf7OV -->
  - `key` _(required)_ — `string` enum: `ListEvents` <!-- id:FW4audj7 -->
  - `input` _(required)_ — map { 8 fields } <!-- id:OLNbt9vw -->
  - `output` _(required)_ — map { 2 fields } <!-- id:MV2CZkha -->

# Depends on <!-- id:y34ksrW0 -->

- [boolean](./onyx-boolean.md) <!-- id:SyPfcrg3 -->
- [string](./onyx-string.md) <!-- id:VrLbVG_X -->
- [seed-activity-event](./seed-activity-event.md) <!-- id:K7mTe_LT -->
