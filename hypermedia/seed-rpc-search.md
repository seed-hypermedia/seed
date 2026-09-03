---
name: "RPC: Search"
summary: "Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field type"
schemaDefinition: ipfs://bafyreidknaifb67i6w72iexqgs65t536k773q4jypfd2x3vyamsltu3pyq
---
Searches the network for documents, contacts, and comments. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:6M7UDKGx -->

This document describes the **seed-rpc-search** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Ua8QFVyl -->

# Shape <!-- id:rNtJKIpN -->

A **closed struct** with these fields: <!-- id:xZHVDSnU -->
  - `key` _(required)_ — `string` enum: `Search` <!-- id:jyBd_Pa7 -->
  - `input` _(required)_ — map { 11 fields } <!-- id:ngg4oBL5 -->
  - `output` _(required)_ — [seed-search-results](./seed-search-results.md) <!-- id:OlDlHyNJ -->

# Depends on <!-- id:OUtj28Fz -->

- [boolean](./onyx-boolean.md) <!-- id:XSL1ytom -->
- [integer](./onyx-integer.md) <!-- id:T4EMUh_q -->
- [string](./onyx-string.md) <!-- id:pea6QrJ4 -->
- [seed-search-results](./seed-search-results.md) <!-- id:oDACMPrv -->
