---
name: "RPC: ListComments"
summary: "Returns all comments on a target document, with the metadata payloads of their authors."
schemaDefinition: ipfs://bafyreiexlmvhw7e5jhoerjldmjxtt25zeeybmvhfoc2dhf5co2lhubvyru
---
Lists all [comments](../protocol/comments.md) on a target [document](../protocol/documents.md), with the metadata payloads of their authors. The result is a [comment list](./type/comment-list.md). <!-- id:YbdgawAp -->

This page describes the **rpc/list-comments** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:OuB5VWl- -->

# Shape <!-- id:c34xkjMP -->

A **closed struct** with these fields: <!-- id:uftselk_ -->
  - `key` _(required)_: `"ListComments"` <!-- id:Ak291hhk -->
  - `input` _(required)_: map { 1 fields } <!-- id:vY6Hzd1z -->
  - `output` _(required)_: [rpc/type/comment-list](./type/comment-list.md) <!-- id:1RJBX7B9 -->

# Depends on <!-- id:uWwOxPlK -->

- [rpc/type/comment-list](./type/comment-list.md) <!-- id:E15hQPIY -->
- [rpc/type/id](./type/id.md) <!-- id:lN6X6Wve -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Comments](../protocol/comments.md): threads and replies.
- [ListDiscussions](./list-discussions.md): the same comments grouped into threads.
- [ListCommentsByAuthor](./list-comments-by-author.md): comments by one author.
