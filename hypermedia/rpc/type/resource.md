---
name: Resource
summary: "The union of every state a fetched resource can be in: document, comment, redirect, not found, tombstone, or error."
schemaDefinition: ipfs://bafyreifrbbw4hsotmyhhozjgy5ujnn33izocem7irfayjryihnyaoqaxui
---
The union of every state a fetched [resource](../../glossary.md) can be in: a [document](./resource-document.md), a [comment](./resource-comment.md), a [redirect](./resource-redirect.md), [not found](./resource-not-found.md), a [tombstone](./resource-tombstone.md), or an [error](./resource-error.md). [rpc/resource](../resource.md) returns it. <!-- id:DKrlmk-b -->

This page describes the **rpc/type/resource** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:8qMDyX3F -->

# Shape <!-- id:QnWTk-_C -->

A **union**. A value matches one of these variants: <!-- id:jNUpA86w -->
  - [rpc/type/resource-document](./resource-document.md) <!-- id:_NMQg8CE -->
  - [rpc/type/resource-comment](./resource-comment.md) <!-- id:7TyvB5RT -->
  - [rpc/type/resource-redirect](./resource-redirect.md) <!-- id:Qk2kHMNK -->
  - [rpc/type/resource-not-found](./resource-not-found.md) <!-- id:puViM4jF -->
  - [rpc/type/resource-tombstone](./resource-tombstone.md) <!-- id:4g2ZdiEu -->
  - [rpc/type/resource-error](./resource-error.md) <!-- id:zAIVwKIe -->

# Depends on <!-- id:N8NdNOBK -->

- [rpc/type/resource-comment](./resource-comment.md) <!-- id:H4xXgtvX -->
- [rpc/type/resource-document](./resource-document.md) <!-- id:TXHngH-I -->
- [rpc/type/resource-error](./resource-error.md) <!-- id:UEIBXH0y -->
- [rpc/type/resource-not-found](./resource-not-found.md) <!-- id:fm6kS7fS -->
- [rpc/type/resource-redirect](./resource-redirect.md) <!-- id:g4RUXR0d -->
- [rpc/type/resource-tombstone](./resource-tombstone.md) <!-- id:30MZAJAa -->

# See also <!-- id:gOc_LNIH -->

- [Resource](../resource.md): the method that returns it. <!-- id:W2LDliym -->
- [Parsed ID](./id.md): the id every state carries. <!-- id:obijvEt- -->
- [Documents](../../protocol/documents.md): redirects and tombstones. <!-- id:UN4FeT97 -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:b8x7B6lc -->
