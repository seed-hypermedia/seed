---
name: "RPC: ListCommentVersions"
summary: "Returns every stored version of a comment, given its id."
schemaDefinition: ipfs://bafyreicihw6ljp4yhqw76clbaldyyan4hlpni3ibakaq3xbc3oynbc76im
---
Lists every stored version of a [comment](../protocol/comments.md), which is its edit history, given its id. Each version is a [comment read model](./type/comment.md). <!-- id:jtYHnqzi -->

This page describes the **rpc/list-comment-versions** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:5sL5PYga -->

# Shape <!-- id:YHu300c6 -->

A **closed struct** with these fields: <!-- id:SGcsRaoX -->
  - `key` _(required)_: `"ListCommentVersions"` <!-- id:dsAhSZXG -->
  - `input` _(required)_: map { 1 fields } <!-- id:M_W98ZGO -->
  - `output` _(required)_: map { 1 fields } <!-- id:ygWtmLNn -->

# Depends on <!-- id:WmdsrswR -->

- [string](../string.md) <!-- id:NRiz7Dmr -->
- [rpc/type/comment](./type/comment.md) <!-- id:-J30-WLH -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Comments](../protocol/comments.md): comments and edits.
- [Comment](./comment.md): fetch one version.
