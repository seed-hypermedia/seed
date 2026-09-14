---
name: Document (Payload)
summary: "A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility)."
schemaDefinition: ipfs://bafyreibweaikfwkisxejlp5er27snrgywcu4x7ynody2y4df6dcsoewe6a
---
A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:rHH1177g -->

This document describes the **rpc/type/document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QZ19vXgV -->

# Shape <!-- id:K1d3WkMR -->

A **closed struct** with these fields: <!-- id:OhtHahKP -->
  - `content` — list of [schema/block/node](../../schema/block/node.md) <!-- id:-PA1LHI- -->
  - `version` — [string](../../schema/string.md) <!-- id:PA6phMO_ -->
  - `account` — [string](../../schema/string.md) <!-- id:vwB-pjkc -->
  - `authors` _(required)_ — list of [string](../../schema/string.md) <!-- id:rv5pKRN_ -->
  - `path` — [string](../../schema/string.md) <!-- id:mwCn1Kvo -->
  - `createTime` — one of [schema/timestamp](../../schema/timestamp.md) | [string](../../schema/string.md) <!-- id:gLksy_CJ -->
  - `updateTime` — one of [schema/timestamp](../../schema/timestamp.md) | [string](../../schema/string.md) <!-- id:eDxwGcV- -->
  - `metadata` _(required)_ — [metadata](../../metadata.md) <!-- id:1Y7BoAam -->
  - `detachedBlocks` — map ⟨ \* : [schema/block/node](../../schema/block/node.md) ⟩ <!-- id:vxG3_Pnt -->
  - `genesis` _(required)_ — [string](../../schema/string.md) <!-- id:X1W8zxVF -->
  - `generationInfo` — map { 2 fields } <!-- id:E5l0dJfG -->
  - `visibility` _(required)_ — [visibility](../../visibility.md) <!-- id:kQ4F7_rH -->

# Depends on <!-- id:Kt0TNJmF -->

- [schema/block/node](../../schema/block/node.md) <!-- id:8Mhlq5zn -->
- [metadata](../../metadata.md) <!-- id:ANUW1WZR -->
- [schema/timestamp](../../schema/timestamp.md) <!-- id:GGHALg_c -->
- [visibility](../../visibility.md) <!-- id:mE3ezOcN -->
- [integer](../../schema/integer.md) <!-- id:lK3bWake -->
- [string](../../schema/string.md) <!-- id:qVYchjv5 -->
