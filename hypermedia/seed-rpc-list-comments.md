---
name: "RPC: ListComments"
summary: "Lists all comments on a target document. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `o"
schemaDefinition: ipfs://bafyreibocdkst2viz7zpigeqmqcgxpuqaqcz5tblkzgxevqacmxb7gv5ky
---
Lists all comments on a target document. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:YbdgawAp -->

This document describes the **seed-rpc-list-comments** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:OuB5VWl- -->

# Shape <!-- id:c34xkjMP -->

A **closed struct** with these fields: <!-- id:uftselk_ -->
  - `key` _(required)_ — `string` enum: `ListComments` <!-- id:Ak291hhk -->
  - `input` _(required)_ — map { 1 fields } <!-- id:vY6Hzd1z -->
  - `output` _(required)_ — [seed-comment-list](./seed-comment-list.md) <!-- id:1RJBX7B9 -->

# Depends on <!-- id:uWwOxPlK -->

- [seed-comment-list](./seed-comment-list.md) <!-- id:E15hQPIY -->
- [seed-id](./seed-id.md) <!-- id:lN6X6Wve -->
