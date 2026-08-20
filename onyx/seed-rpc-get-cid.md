---
name: "RPC: GetCID"
summary: "Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you p"
---

# RPC: GetCID

Fetches a raw IPFS block by CID and decodes it. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-get-cid** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `GetCID`
- `input` *(required)* — map { 1 fields }
- `output` *(required)* — map { 1 fields }

## Depends on

- [any](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/any)
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
