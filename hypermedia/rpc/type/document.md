---
name: Document (Payload)
summary: "A document as the API returns it: the signed document’s metadata and content plus derived fields such as resolved version, authors, timestamps, and visibility."
schemaDefinition: ipfs://bafyreie3ylin72g7b6tphntqkrzhube33rfwwruvb4a7672lrirgvmniqq
---
A [document](../../protocol/documents.md) as the API returns it: the signed document's [metadata](../../metadata.md) and [content](../../protocol/blocks.md), plus derived fields such as the resolved version, authors, timestamps and [visibility](../../protocol/privacy.md). [rpc/resource](../resource.md) returns it inside a [document resource](./resource-document.md). <!-- id:rHH1177g -->

This page describes the **rpc/type/document** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:QZ19vXgV -->

# Shape <!-- id:K1d3WkMR -->

A **closed struct** with these fields: <!-- id:OhtHahKP -->
  - `content`: list of [block/node](../../block/node.md) <!-- id:-PA1LHI- -->
  - `version`: [string](../../string.md) <!-- id:PA6phMO_ -->
  - `account`: [string](../../string.md) <!-- id:vwB-pjkc -->
  - `authors` _(required)_: list of [string](../../string.md) <!-- id:rv5pKRN_ -->
  - `path`: [string](../../string.md) <!-- id:mwCn1Kvo -->
  - `createTime`: one of [timestamp](../../timestamp.md) | [string](../../string.md) <!-- id:gLksy_CJ -->
  - `updateTime`: one of [timestamp](../../timestamp.md) | [string](../../string.md) <!-- id:eDxwGcV- -->
  - `metadata` _(required)_: [metadata](../../metadata.md) <!-- id:1Y7BoAam -->
  - `detachedBlocks`: map ⟨ \* : [block/node](../../block/node.md) ⟩ <!-- id:vxG3_Pnt -->
  - `genesis` _(required)_: [string](../../string.md) <!-- id:X1W8zxVF -->
  - `generationInfo`: map { 2 fields } <!-- id:E5l0dJfG -->
  - `visibility` _(required)_: [visibility](../../visibility.md) <!-- id:kQ4F7_rH -->

# Depends on <!-- id:Kt0TNJmF -->

- [block/node](../../block/node.md) <!-- id:8Mhlq5zn -->
- [metadata](../../metadata.md) <!-- id:ANUW1WZR -->
- [timestamp](../../timestamp.md) <!-- id:GGHALg_c -->
- [visibility](../../visibility.md) <!-- id:mE3ezOcN -->
- [integer](../../integer.md) <!-- id:lK3bWake -->
- [string](../../string.md) <!-- id:qVYchjv5 -->

# See also

- [Document](../../document.md): the document term page.
- [Documents](../../protocol/documents.md): changes, refs and versions.
- [Document Info](./document-info.md): the listing form without content.
- [Resource](../resource.md): the method that fetches documents.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
