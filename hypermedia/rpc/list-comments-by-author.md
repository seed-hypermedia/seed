---
name: "RPC: ListCommentsByAuthor"
summary: "Returns the comments an author has written, with the author metadata payloads, given the author’s id."
schemaDefinition: ipfs://bafyreidbsu2gvj4paq4fbjwww32mwasv2ycfw4w36tlze4zh7qfdlb3dea
---
Lists the comments an author has written. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:TNeyZeWT -->

This page describes the **rpc/list-comments-by-author** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:Yo-aNsvf -->

# Shape <!-- id:SmqiIOrD -->

A **closed struct** with these fields: <!-- id:LP2wLk4H -->
  - `key` _(required)_ — `"ListCommentsByAuthor"` <!-- id:6ScncCpi -->
  - `input` _(required)_ — map { 1 fields } <!-- id:NyEpluIW -->
  - `output` _(required)_ — [rpc/type/comment-list](./type/comment-list.md) <!-- id:r5kRTsmu -->

# Depends on <!-- id:OKsUfq8K -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:-JnWEZdC -->
- [rpc/type/id](./type/id.md) <!-- id:DFyGRqV- -->
