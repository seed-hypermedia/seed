---
name: "RPC: ListDomains"
summary: "Lists all site domains the daemon knows about. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pa"
---

# RPC: ListDomains

Lists all site domains the daemon knows about. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-list-domains** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `ListDomains`
- `input` *(required)* — map
- `output` *(required)* — map { 1 fields }

## Depends on

- [seed-domain-info](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-domain-info)
