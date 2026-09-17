---
name: "RPC: ListComments"
summary: "Returns all comments on a target document, with the metadata payloads of their authors."
schemaDefinition: ipfs://bafyreiexlmvhw7e5jhoerjldmjxtt25zeeybmvhfoc2dhf5co2lhubvyru
---
Lists all comments on a target document. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:YbdgawAp -->

This page describes the **rpc/list-comments** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:OuB5VWl- -->

# Shape <!-- id:c34xkjMP -->

A **closed struct** with these fields: <!-- id:uftselk_ -->
  - `key` _(required)_ — `"ListComments"` <!-- id:Ak291hhk -->
  - `input` _(required)_ — map { 1 fields } <!-- id:vY6Hzd1z -->
  - `output` _(required)_ — [rpc/type/comment-list](./type/comment-list.md) <!-- id:1RJBX7B9 -->

# Depends on <!-- id:uWwOxPlK -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:E15hQPIY -->
- [rpc/type/id](./type/id.md) <!-- id:lN6X6Wve -->
