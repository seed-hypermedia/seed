---
name: "RPC: ListCommentVersions"
summary: "Returns every stored version of a comment, given its id."
schemaDefinition: ipfs://bafyreicihw6ljp4yhqw76clbaldyyan4hlpni3ibakaq3xbc3oynbc76im
---
Lists the edit history (all versions) of a comment. One method of the Seed universal-client API: `request(key, input) -> output`. The `input` field types what you pass; `output` types what comes back. <!-- id:jtYHnqzi -->

This page describes the **rpc/list-comment-versions** method of the Seed API — a read model of what the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:5sL5PYga -->

# Shape <!-- id:YHu300c6 -->

A **closed struct** with these fields: <!-- id:SGcsRaoX -->
  - `key` _(required)_ — `"ListCommentVersions"` <!-- id:dsAhSZXG -->
  - `input` _(required)_ — map { 1 fields } <!-- id:M_W98ZGO -->
  - `output` _(required)_ — map { 1 fields } <!-- id:ygWtmLNn -->

# Depends on <!-- id:WmdsrswR -->

- [string](../string.md) <!-- id:NRiz7Dmr -->
- [rpc/type/comment](./type/comment.md) <!-- id:-J30-WLH -->
