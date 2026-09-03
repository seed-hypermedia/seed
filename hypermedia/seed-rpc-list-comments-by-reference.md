---
name: "RPC: ListCommentsByReference"
summary: "Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output"
schemaDefinition: ipfs://bafyreihx25u4aouxzvwnmgtkg5tidhhvbebdtemmsnom4bfcae3tb42wfu
---
Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:Zqcrf57v -->

This document describes the **seed-rpc-list-comments-by-reference** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5eUKh3i5 -->

# Shape <!-- id:i2iLp9HU -->
A **closed struct** with these fields: <!-- id:w_aoeIfy -->
  - `key` _(required)_ — `string` enum: `ListCommentsByReference` <!-- id:CE40T36c -->
  - `input` _(required)_ — map { 1 fields } <!-- id:3dWih2WE -->
  - `output` _(required)_ — [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list) <!-- id:kDDoWxNB -->

# Depends on <!-- id:2-ilVUqp -->
- [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list) <!-- id:XNc4mZdP -->
- [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) <!-- id:O57rd3n4 -->