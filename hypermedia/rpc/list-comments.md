---
name: "RPC: ListComments"
summary: "Lists all comments on a target document. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `o"
schemaDefinition: ipfs://bafyreihvh6edzp27mv27n22rsp2cu6agsozxmzt5wzix4p4jfk2z7bvala
---
Lists all comments on a target document. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:YbdgawAp -->

This document describes the **rpc/list-comments** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OuB5VWl- -->

# Shape <!-- id:c34xkjMP -->

A **closed struct** with these fields: <!-- id:uftselk_ -->
  - `key` _(required)_ — `"ListComments"` <!-- id:Ak291hhk -->
  - `input` _(required)_ — map { 1 fields } <!-- id:vY6Hzd1z -->
  - `output` _(required)_ — [rpc/type/comment-list](./type/comment-list.md) <!-- id:1RJBX7B9 -->

# Depends on <!-- id:uWwOxPlK -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:E15hQPIY -->
- [rpc/type/id](./type/id.md) <!-- id:lN6X6Wve -->
