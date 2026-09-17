---
name: "Resource: Comment"
summary: "A resolved resource that is a comment: the parsed id plus the comment read model."
schemaDefinition: ipfs://bafyreifh4ympsbhu6enq2voev5zysuaneaasbtfxql3vuvxdxots2qnadu
---
A resolved [resource](../../glossary.md) that is a [comment](../../protocol/comments.md): the [parsed id](./id.md) plus the [comment read model](./comment.md). It is one state of [rpc/type/resource](./resource.md). <!-- id:VLm0UyTJ -->

This page describes the **rpc/type/resource-comment** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:WM00tRcd -->

# Shape <!-- id:EAMFXFtn -->

A **closed struct** with these fields: <!-- id:CTozbhjz -->
  - `type` _(required)_: `"comment"` <!-- id:ZLI-MfCl -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:UInd1qiG -->
  - `comment` _(required)_: [rpc/type/comment](./comment.md) <!-- id:YUJFaUl6 -->

# Depends on <!-- id:Mg_oNLnv -->

- [rpc/type/comment](./comment.md) <!-- id:LtTxleFu -->
- [rpc/type/id](./id.md) <!-- id:ExCrWOlT -->

# See also <!-- id:LAjSTsHV -->

- [Resource](./resource.md): every resource state. <!-- id:cwASTuDM -->
- [Resource: Document](./resource-document.md): the document state. <!-- id:xi6ZxQIR -->
- [Comment (Payload)](./comment.md): the comment read model. <!-- id:ziz1aty7 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:rT85lvUz -->
