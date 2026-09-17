---
name: Resource
summary: "The union of every state a fetched resource can be in: document, comment, redirect, not found, tombstone, or error."
---
The union of every state a fetched [resource](../../glossary.md) can be in: a [document](./resource-document.md), a [comment](./resource-comment.md), a [redirect](./resource-redirect.md), [not found](./resource-not-found.md), a [tombstone](./resource-tombstone.md), or an [error](./resource-error.md). [rpc/resource](../resource.md) returns it. <!-- id:DKrlmk-b -->

This page describes the **rpc/type/resource** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:8qMDyX3F -->

# See also <!-- id:gOc_LNIH -->

- [Resource](../resource.md): the method that returns it. <!-- id:W2LDliym -->
- [Parsed ID](./id.md): the id every state carries. <!-- id:obijvEt- -->
- [Documents](../../protocol/documents.md): redirects and tombstones. <!-- id:UN4FeT97 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:b8x7B6lc -->
