---
name: "RPC: ListDiscussions"
summary: "Returns a document’s comments grouped into threads, their authors’ metadata, and threads from other documents that cite it, optionally focused on one comment."
schemaDefinition: ipfs://bafyreif2nqvfoox4pevp4mn4ak4i6zeemflv7cwkzwpmscxtlc3msve7jy
---
Lists threaded discussions on a document (optionally focused on one comment), plus citing discussions from other documents. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:unbh1D7h -->

This page describes the **rpc/list-discussions** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:bvGkwgJy -->

# Shape <!-- id:14v3gfqr -->

A **closed struct** with these fields: <!-- id:uJXPLY-q -->
  - `key` _(required)_ — `"ListDiscussions"` <!-- id:p6d04XQy -->
  - `input` _(required)_ — map { 2 fields } <!-- id:fybr3u6u -->
  - `output` _(required)_ — map { 3 fields } <!-- id:FTUq7QAy -->

# Depends on <!-- id:nX0aBcJ0 -->

- [string](../string.md) <!-- id:LeFBWwLK -->
- [rpc/type/comment-group](./type/comment-group.md) <!-- id:lJbYAfO0 -->
- [rpc/type/external-comment-group](./type/external-comment-group.md) <!-- id:C9Smaf8c -->
- [rpc/type/id](./type/id.md) <!-- id:U1EQAqgK -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:sJQj_K4p -->
