---
name: "RPC: GetCID"
summary: "Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you p"
schemaDefinition: ipfs://bafyreieq6eleagpflqjjhv7d3m2ibkhxcp7bh6rz4oh6ih7l2ebedqjmwm
---
Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:KrdeFkDA -->

This document describes the **seed-rpc-get-cid** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:rPC2zBYZ -->

# Shape <!-- id:0EwBrMzm -->

A **closed struct** with these fields: <!-- id:HzFHBpWO -->
  - `key` _(required)_ — `"GetCID"` <!-- id:ZJCBLccu -->
  - `input` _(required)_ — map { 1 fields } <!-- id:AF0I_I1D -->
  - `output` _(required)_ — map { 1 fields } <!-- id:ERIh36-p -->

# Depends on <!-- id:ardnz0nd -->

- [any](./hypermedia-any.md) <!-- id:xxcRpn4k -->
- [string](./hypermedia-string.md) <!-- id:rLVe6evY -->
