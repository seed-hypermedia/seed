---
name: "RPC: ListCommentsByReference"
summary: Returns the comments that reference a specific block, given a target id that carries the block reference.
---
Lists the [comments](../protocol/comments.md) that reference one [block](../protocol/blocks.md). The target id carries the block reference in `blockRef`. The result is a [comment list](./type/comment-list.md). <!-- id:Zqcrf57v -->

This page describes the **rpc/list-comments-by-reference** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:5eUKh3i5 -->

# See also <!-- id:apO9Kjgw -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:pbPCc77D -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:UUBc6aHQ -->
- [RPC](./method.md): every method in one union. <!-- id:ASfkbuTg -->
- [Hypermedia URLs](../protocol/urls.md): block references in a URL. <!-- id:4XASzq9T -->
- [ListComments](./list-comments.md): all comments on a document. <!-- id:LgE_yxoX -->
- [Parsed ID](./type/id.md): the id shape that carries `blockRef`. <!-- id:nP95SFOj -->
