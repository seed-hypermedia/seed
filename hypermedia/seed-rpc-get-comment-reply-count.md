---
name: "RPC: GetCommentReplyCount"
summary: "Counts the replies under a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output"
schemaDefinition: ipfs://bafyreiaq3a6dnk2ljfssq2cxrqy4lbd3bxg6fnifowgic4bii563px6iyq
---
Counts the replies under a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:POuk7vni -->

This document describes the **seed-rpc-get-comment-reply-count** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:8hdP6P3f -->

# Shape <!-- id:sNw03qUK -->

A **closed struct** with these fields: <!-- id:YNWk_gey -->
  - `key` _(required)_ — `string` enum: `GetCommentReplyCount` <!-- id:tfs8yaTl -->
  - `input` _(required)_ — map { 1 fields } <!-- id:k-2gNoga -->
  - `output` _(required)_ — `integer` <!-- id:1Qwp8u7V -->

# Depends on <!-- id:ruuwrb5M -->

- [string](./onyx-string.md) <!-- id:L1b4cqBz -->
