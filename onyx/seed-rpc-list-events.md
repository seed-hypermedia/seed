---
name: "RPC: ListEvents"
summary: "Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` fi"
---

# RPC: ListEvents

Pages through the activity feed, with author/type/resource filters. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-list-events** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `ListEvents`
- `input` *(required)* — map { 8 fields }
- `output` *(required)* — map { 2 fields }

## Depends on

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean)
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-activity-event](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-activity-event)
