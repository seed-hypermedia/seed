---
name: "RPC: ListCommentVersions"
summary: "Lists the edit history (all versions) of a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what y"
schemaDefinition: ipfs://bafyreiafbi6zqx5mcibjkrz4maf3xg5hitzlzjxh6pf5uoox6q5tsnmcz4
---
Lists the edit history (all versions) of a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:jtYHnqzi -->

This document describes the **rpc/list-comment-versions** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5sL5PYga -->

# Shape <!-- id:YHu300c6 -->

A **closed struct** with these fields: <!-- id:SGcsRaoX -->
  - `key` _(required)_ — `"ListCommentVersions"` <!-- id:dsAhSZXG -->
  - `input` _(required)_ — map { 1 fields } <!-- id:M_W98ZGO -->
  - `output` _(required)_ — map { 1 fields } <!-- id:ygWtmLNn -->

# Depends on <!-- id:WmdsrswR -->

- [string](../schema/string.md) <!-- id:NRiz7Dmr -->
- [rpc/type/comment](./type/comment.md) <!-- id:-J30-WLH -->
