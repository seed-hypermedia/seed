---
name: "RPC: QueryBlock"
summary: "Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input`"
---

# RPC: QueryBlock

Runs a Query block's query and returns everything its rendering needs. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-query-block** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `QueryBlock`
- `input` *(required)* — map { 1 fields }
- `output` *(required)* — one of [seed-query-block-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-payload) | [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)

## Depends on

- [hypermedia-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query)
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null)
- [seed-query-block-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-block-payload)
