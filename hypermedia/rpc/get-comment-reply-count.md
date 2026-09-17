---
name: "RPC: GetCommentReplyCount"
summary: "Returns the number of replies under a comment, given the comment id."
schemaDefinition: ipfs://bafyreiesdg7ica6z7vg6f7jyhygcyrxv7bsh5rpyb4vnqitfa6q2lmwnl4
---
Counts the replies under a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:POuk7vni -->

This page describes the **rpc/get-comment-reply-count** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:8hdP6P3f -->

# Shape <!-- id:sNw03qUK -->

A **closed struct** with these fields: <!-- id:YNWk_gey -->
  - `key` _(required)_: `"GetCommentReplyCount"` <!-- id:tfs8yaTl -->
  - `input` _(required)_: map { 1 fields } <!-- id:k-2gNoga -->
  - `output` _(required)_: `integer` <!-- id:1Qwp8u7V -->

# Depends on <!-- id:ruuwrb5M -->

- [string](../string.md) <!-- id:L1b4cqBz -->
