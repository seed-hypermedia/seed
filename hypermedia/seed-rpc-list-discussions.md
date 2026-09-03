---
name: "RPC: ListDiscussions"
summary: Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-cli
schemaDefinition: ipfs://bafyreiheqwjo5ckqj64vqgmznlk3gar5ydhhkhfv4hhmkhwzq6q3gn3awy
---
Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:unbh1D7h -->

This document describes the **seed-rpc-list-discussions** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:bvGkwgJy -->

# Shape <!-- id:14v3gfqr -->

A **closed struct** with these fields: <!-- id:uJXPLY-q -->
  - `key` _(required)_ — `string` enum: `ListDiscussions` <!-- id:p6d04XQy -->
  - `input` _(required)_ — map { 2 fields } <!-- id:fybr3u6u -->
  - `output` _(required)_ — map { 3 fields } <!-- id:FTUq7QAy -->

# Depends on <!-- id:nX0aBcJ0 -->

- [string](./onyx-string.md) <!-- id:LeFBWwLK -->
- [seed-comment-group](./seed-comment-group.md) <!-- id:lJbYAfO0 -->
- [seed-external-comment-group](./seed-external-comment-group.md) <!-- id:C9Smaf8c -->
- [seed-id](./seed-id.md) <!-- id:U1EQAqgK -->
- [seed-metadata-payload](./seed-metadata-payload.md) <!-- id:sJQj_K4p -->
