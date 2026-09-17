---
name: "RPC: ListDiscussions"
summary: Returns a document’s comments grouped into threads, their authors’ metadata, and threads from other documents that cite it, optionally focused on one comment.
---
Lists the [comment](../protocol/comments.md) threads on a [document](../protocol/documents.md), optionally focused on one comment. It also returns threads from other documents that cite this one. Threads come back as [comment groups](./type/comment-group.md) and [external comment groups](./type/external-comment-group.md), with their authors' metadata. <!-- id:unbh1D7h -->

This page describes the **rpc/list-discussions** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:bvGkwgJy -->

# See also <!-- id:5QHGzGqn -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:gnHS8Qwh -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:JQ_0-cZQ -->
- [RPC](./method.md): every method in one union. <!-- id:Ufzs7ZBL -->
- [Comments](../protocol/comments.md): threads, replies and citations. <!-- id:kKmBcI8M -->
- [ListComments](./list-comments.md): the flat list of comments. <!-- id:kONcGGXX -->
- [GetCommentReplyCount](./get-comment-reply-count.md): replies under one comment. <!-- id:DJXYg9nq -->
