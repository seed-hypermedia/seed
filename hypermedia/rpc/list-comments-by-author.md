---
name: "RPC: ListCommentsByAuthor"
summary: Returns the comments an author has written, with the author metadata payloads, given the author’s id.
---
Lists the [comments](../protocol/comments.md) an author has written, with the author metadata payloads, given the author's id. The result is a [comment list](./type/comment-list.md). <!-- id:TNeyZeWT -->

This page describes the **rpc/list-comments-by-author** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:Yo-aNsvf -->

# See also <!-- id:ro8vPV-5 -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:bsFcUHJE -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:kQ_Ltevg -->
- [RPC](./method.md): every method in one union. <!-- id:XGT36ePZ -->
- [Comments](../protocol/comments.md): threads and replies. <!-- id:5tIwb97v -->
- [ListComments](./list-comments.md): all comments on a document. <!-- id:X5RhA4gZ -->
- [ListCommentsByReference](./list-comments-by-reference.md): comments on one block. <!-- id:3ZoBcp6g -->
