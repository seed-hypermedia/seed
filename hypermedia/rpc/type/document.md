---
name: Document (Payload)
summary: "A document as the API returns it: the signed document’s metadata and content plus derived fields such as resolved version, authors, timestamps, and visibility."
schemaDefinition: ipfs://bafyreie3ylin72g7b6tphntqkrzhube33rfwwruvb4a7672lrirgvmniqq
---
A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:rHH1177g -->

This page describes the **rpc/type/document** read model of the Seed API — derived data the daemon computes for clients, not a signed network blob. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:QZ19vXgV -->

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
