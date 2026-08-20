---
name: "RPC: ListCommentsByReference"
summary: "Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output"
---

# RPC: ListCommentsByReference

Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back.


This document describes the **seed-rpc-list-comments-by-reference** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **closed struct** with these fields:

- `key` *(required)* — `string` enum: `ListCommentsByReference`
- `input` *(required)* — map { 1 fields }
- `output` *(required)* — [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list)

## Depends on

- [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list)
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)
