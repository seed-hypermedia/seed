---
name: Comment Group
summary: "A thread of comments grouped for display, with a count of elided replies."
schemaDefinition: ipfs://bafyreie4js3bfbqu6gk6hyn2houaoxcadbmevayoxjrj7tcpbsmi6ccxaa
---
A thread of [comments](../../protocol/comments.md) grouped for display, with a count of the replies left out. [rpc/list-discussions](../list-discussions.md) returns these. <!-- id:kfaho3GA -->

This page describes the **rpc/type/comment-group** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:XEbgwnCN -->

# Shape <!-- id:bn9hhdhT -->

A **closed struct** with these fields: <!-- id:hQ_A0BRE -->
  - `comments` _(required)_: list of [rpc/type/comment](./comment.md) <!-- id:6j0dIlAA -->
  - `moreCommentsCount` _(required)_: `integer` <!-- id:YX7_v3Cs -->
  - `id` _(required)_: [string](../../string.md) <!-- id:LESTYzIE -->
  - `type` _(required)_: `"commentGroup"` <!-- id:8G00dDGM -->

# Depends on <!-- id:zRpGsTRj -->

- [string](../../string.md) <!-- id:Cmnm7JiI -->
- [rpc/type/comment](./comment.md) <!-- id:fg2iMFOh -->

# See also

- [External Comment Group](./external-comment-group.md): a thread from a citing document.
- [Comment (Payload)](./comment.md): each comment.
- [ListDiscussions](../list-discussions.md): the method that returns groups.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
