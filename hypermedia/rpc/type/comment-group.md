---
name: Comment Group
summary: A thread of comments grouped for display, with a count of elided replies.
---
A thread of [comments](../../protocol/comments.md) grouped for display, with a count of the replies left out. [rpc/list-discussions](../list-discussions.md) returns these. <!-- id:kfaho3GA -->

This page describes the **rpc/type/comment-group** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:XEbgwnCN -->

# See also <!-- id:JZ1PE70_ -->

- [External Comment Group](./external-comment-group.md): a thread from a citing document. <!-- id:YJtB8mYe -->
- [Comment (Payload)](./comment.md): each comment. <!-- id:gbPTHWR8 -->
- [ListDiscussions](../list-discussions.md): the method that returns groups. <!-- id:cI1pM5j8 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:AYRaAOGf -->
