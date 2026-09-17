---
name: "RPC: ListCommentsByReference"
summary: "Returns the comments that reference a specific block, given a target id that carries the block reference."
schemaDefinition: ipfs://bafyreifxlq7hat24yrsyhhkbr355q6tsxku6hkuaezkamh2kzwah2wmyva
---
Lists comments that reference a specific block (the target id carries the blockRef). One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:Zqcrf57v -->

This page describes the **rpc/list-comments-by-reference** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:5eUKh3i5 -->

# Shape <!-- id:i2iLp9HU -->

A **closed struct** with these fields: <!-- id:w_aoeIfy -->
  - `key` _(required)_ — `"ListCommentsByReference"` <!-- id:CE40T36c -->
  - `input` _(required)_ — map { 1 fields } <!-- id:3dWih2WE -->
  - `output` _(required)_ — [rpc/type/comment-list](./type/comment-list.md) <!-- id:kDDoWxNB -->

# Depends on <!-- id:2-ilVUqp -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:XNc4mZdP -->
- [rpc/type/id](./type/id.md) <!-- id:O57rd3n4 -->
