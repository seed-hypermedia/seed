---
name: "RPC: Comment"
summary: Returns one comment as the API read model, given its id (uid/tsid) or a version CID.
---
Fetches one [comment](../protocol/comments.md) by its id (uid/tsid) or by a version [CID](../protocol/blobs.md). The result is the [comment read model](./type/comment.md). <!-- id:iF3gr7CN -->

This page describes the **rpc/comment** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed blobs that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:kND-xRJl -->

# See also <!-- id:DZONOhuP -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:cBCJL9eU -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:bQNd2vik -->
- [RPC](./method.md): every method in one union. <!-- id:dRa6YAQO -->
- [Comments](../protocol/comments.md): threads, replies and citations. <!-- id:7usFGhxD -->
- [Comment](../comment.md): the signed comment blob. <!-- id:Qxg3NEfM -->
- [ListCommentVersions](./list-comment-versions.md): every version of a comment. <!-- id:nddsdrIt -->
- [ListComments](./list-comments.md): all comments on a document. <!-- id:crlIsNo1 -->
