---
name: "Resource: Document"
summary: "A resolved resource that is a document: the parsed id plus the document read model."
schemaDefinition: ipfs://bafyreifqd325u5vk2vtbwaxkykd7bo5tzyejvk7ocdbpovjtdabhqslgem
---
A resolved [resource](../../glossary.md) that is a [document](../../protocol/documents.md): the [parsed id](./id.md) plus the [document read model](./document.md). It is one state of [rpc/type/resource](./resource.md).

This page describes the **rpc/type/resource-document** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:osbL_VzO -->

# Shape <!-- id:lpqlXCiW -->

A **closed struct** with these fields: <!-- id:4vWhQD8X -->
  - `type` _(required)_: `"document"` <!-- id:-ZUj4U6x -->
  - `id` _(required)_: [rpc/type/id](./id.md) <!-- id:lPijxTTm -->
  - `document` _(required)_: [rpc/type/document](./document.md) <!-- id:HFUZ5Hqy -->

# Depends on <!-- id:FEOuuSm1 -->

- [rpc/type/document](./document.md) <!-- id:9L9x-KOf -->
- [rpc/type/id](./id.md) <!-- id:gb8yXdwT -->

# See also

- [Resource](./resource.md): every resource state.
- [Resource: Comment](./resource-comment.md): the comment state.
- [Document (Payload)](./document.md): the document read model.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
