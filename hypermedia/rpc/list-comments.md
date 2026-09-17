---
name: "RPC: ListComments"
summary: Returns all comments on a target document, with the metadata payloads of their authors.
---
Lists all [comments](../protocol/comments.md) on a target [document](../protocol/documents.md), with the metadata payloads of their authors. The result is a [comment list](./type/comment-list.md). <!-- id:YbdgawAp -->

This page describes the **rpc/list-comments** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:OuB5VWl- -->

# See also <!-- id:bhX0-3rw -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:_yI7OsYa -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:4S7UiG01 -->
- [RPC](./method.md): every method in one union. <!-- id:gFRCpTNV -->
- [Comments](../protocol/comments.md): threads and replies. <!-- id:5kWhIoxz -->
- [ListDiscussions](./list-discussions.md): the same comments grouped into threads. <!-- id:ytZLEqH5 -->
- [ListCommentsByAuthor](./list-comments-by-author.md): comments by one author. <!-- id:2FzhwRZU -->
