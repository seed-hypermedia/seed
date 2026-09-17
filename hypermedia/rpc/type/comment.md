---
name: Comment (Payload)
summary: "A comment as the API returns it: the signed comment’s content plus derived fields such as stable id, version CID, thread links, timestamps, and visibility."
---
A [comment](../../protocol/comments.md) as the API returns it: the signed comment's content plus derived fields such as its stable id, version [CID](../../protocol/blobs.md), thread links, timestamps and [visibility](../../protocol/privacy.md). The signed blob is [comment](../../comment.md). <!-- id:3cDEwf1- -->

This page describes the **rpc/type/comment** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed blobs that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:dubklf6x -->

# See also <!-- id:poya4uNW -->

- [Comment](../../comment.md): the signed comment blob. <!-- id:v45QksSn -->
- [Comment](../comment.md): the method that fetches one comment. <!-- id:bD1IPWNX -->
- [Comment List](./comment-list.md): comments with author metadata. <!-- id:Wa95DTSp -->
- [Comments](../../protocol/comments.md): threads and replies. <!-- id:YGJekBn- -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:a19mHxCo -->
