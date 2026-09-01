---
name: "RPC: ListDiscussions"
summary: "Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-cli"
---

# RPC: ListDiscussions

Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-list-discussions** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `ListDiscussions`
- `input` *(required)* — map { 2 fields }
- `output` *(required)* — map { 3 fields }

## Depends on

- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string)
- [seed-comment-group](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-group)
- [seed-external-comment-group](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-external-comment-group)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
- [seed-metadata-payload](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-metadata-payload)
