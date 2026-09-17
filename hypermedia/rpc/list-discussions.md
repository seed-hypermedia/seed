---
name: "RPC: ListDiscussions"
summary: Returns a document’s comments grouped into threads, their authors’ metadata, and threads from other documents that cite it, optionally focused on one comment.
schemaDefinition: ipfs://bafyreif2nqvfoox4pevp4mn4ak4i6zeemflv7cwkzwpmscxtlc3msve7jy
---
Lists the [comment](../protocol/comments.md) threads on a [document](../protocol/documents.md), optionally focused on one comment. It also returns threads from other documents that cite this one. Threads come back as [comment groups](./type/comment-group.md) and [external comment groups](./type/external-comment-group.md), with their authors' metadata. <!-- id:unbh1D7h -->

This page describes the **rpc/list-discussions** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:bvGkwgJy -->

# Shape <!-- id:14v3gfqr -->

A **closed struct** with these fields: <!-- id:uJXPLY-q -->
  - `key` _(required)_: `"ListDiscussions"` <!-- id:p6d04XQy -->
  - `input` _(required)_: map { 2 fields } <!-- id:fybr3u6u -->
  - `output` _(required)_: map { 3 fields } <!-- id:FTUq7QAy -->

# Depends on <!-- id:nX0aBcJ0 -->

- [string](../string.md) <!-- id:LeFBWwLK -->
- [rpc/type/comment-group](./type/comment-group.md) <!-- id:lJbYAfO0 -->
- [rpc/type/external-comment-group](./type/external-comment-group.md) <!-- id:C9Smaf8c -->
- [rpc/type/id](./type/id.md) <!-- id:U1EQAqgK -->
- [rpc/type/metadata-payload](./type/metadata-payload.md) <!-- id:sJQj_K4p -->

# See also <!-- id:5QHGzGqn -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:gnHS8Qwh -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:JQ_0-cZQ -->
- [RPC](./method.md): every method in one union. <!-- id:Ufzs7ZBL -->
- [Comments](../protocol/comments.md): threads, replies and citations. <!-- id:kKmBcI8M -->
- [ListComments](./list-comments.md): the flat list of comments. <!-- id:kONcGGXX -->
- [GetCommentReplyCount](./get-comment-reply-count.md): replies under one comment. <!-- id:DJXYg9nq -->
