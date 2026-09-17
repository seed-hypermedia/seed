---
name: "RPC: ListCommentsByAuthor"
summary: "Returns the comments an author has written, with the author metadata payloads, given the author’s id."
schemaDefinition: ipfs://bafyreidbsu2gvj4paq4fbjwww32mwasv2ycfw4w36tlze4zh7qfdlb3dea
---
Lists the [comments](../protocol/comments.md) an author has written, with the author metadata payloads, given the author's id. The result is a [comment list](./type/comment-list.md). <!-- id:TNeyZeWT -->

This page describes the **rpc/list-comments-by-author** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:Yo-aNsvf -->

# Shape <!-- id:SmqiIOrD -->

A **closed struct** with these fields: <!-- id:LP2wLk4H -->
  - `key` _(required)_: `"ListCommentsByAuthor"` <!-- id:6ScncCpi -->
  - `input` _(required)_: map { 1 fields } <!-- id:NyEpluIW -->
  - `output` _(required)_: [rpc/type/comment-list](./type/comment-list.md) <!-- id:r5kRTsmu -->

# Depends on <!-- id:OKsUfq8K -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:-JnWEZdC -->
- [rpc/type/id](./type/id.md) <!-- id:DFyGRqV- -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Comments](../protocol/comments.md): threads and replies.
- [ListComments](./list-comments.md): all comments on a document.
- [ListCommentsByReference](./list-comments-by-reference.md): comments on one block.
