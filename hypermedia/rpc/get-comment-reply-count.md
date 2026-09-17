---
name: "RPC: GetCommentReplyCount"
summary: Returns the number of replies under a comment, given the comment id.
schemaDefinition: ipfs://bafyreiesdg7ica6z7vg6f7jyhygcyrxv7bsh5rpyb4vnqitfa6q2lmwnl4
---
Counts the replies under a [comment](../protocol/comments.md), given the comment id. <!-- id:POuk7vni -->

This page describes the **rpc/get-comment-reply-count** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:8hdP6P3f -->

# Shape <!-- id:sNw03qUK -->

A **closed struct** with these fields: <!-- id:YNWk_gey -->
  - `key` _(required)_: `"GetCommentReplyCount"` <!-- id:tfs8yaTl -->
  - `input` _(required)_: map { 1 fields } <!-- id:k-2gNoga -->
  - `output` _(required)_: `integer` <!-- id:1Qwp8u7V -->

# Depends on <!-- id:ruuwrb5M -->

- [string](../string.md) <!-- id:L1b4cqBz -->

# See also <!-- id:rmbFlq7w -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:0WdHEs8J -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:2uxNATbg -->
- [RPC](./method.md): every method in one union. <!-- id:IOyUwyhC -->
- [Comments](../protocol/comments.md): threads and replies. <!-- id:F0YPlPcx -->
- [Comment](./comment.md): fetch one comment. <!-- id:dcZzK8bX -->
- [ListDiscussions](./list-discussions.md): comment threads on a document. <!-- id:Jv4Wr1fc -->
