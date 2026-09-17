---
name: Comment List
summary: A list of comments plus the metadata payloads of every author involved.
schemaDefinition: ipfs://bafyreig3f4ozdxbg2tlctxfnt6pdd24nrmyhyurjimdddw5pjcbkcgtpq4
---
A list of [comments](../../protocol/comments.md) plus the metadata payloads of every author involved. [rpc/list-comments](../list-comments.md) returns it, as do the by-author and by-reference variants. <!-- id:YsLbrH3B -->

This page describes the **rpc/type/comment-list** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:NORHzsPw -->

# Shape <!-- id:PppnBW7I -->

A **closed struct** with these fields: <!-- id:KZctBNHM -->
  - `comments` _(required)_: list of [rpc/type/comment](./comment.md) <!-- id:kVFQBkzL -->
  - `authors` _(required)_: map ⟨ \* : [rpc/type/metadata-payload](./metadata-payload.md) ⟩ <!-- id:ZBgvETJb -->

# Depends on <!-- id:Xlb8F54n -->

- [rpc/type/comment](./comment.md) <!-- id:uEtChrVR -->
- [rpc/type/metadata-payload](./metadata-payload.md) <!-- id:Dt3ONyxv -->

# See also <!-- id:HzzRUmYv -->

- [Comment (Payload)](./comment.md): each comment. <!-- id:YpvfgdzR -->
- [Metadata Payload](./metadata-payload.md): each author. <!-- id:zV2Qr5Nj -->
- [ListCommentsByAuthor](../list-comments-by-author.md): comments by one author. <!-- id:-RKpmIFP -->
- [ListCommentsByReference](../list-comments-by-reference.md): comments on one block. <!-- id:PoAai1ze -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:TAi6TM-k -->
