---
name: Document (payload)
summary: "A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility)."
schemaDefinition: ipfs://bafyreidvlin4ind4v52mfrrrktny6jkkrs3s7v4enyqbe6j32zh544ny3a
---
A document as the API returns it to clients: the signed document's metadata and content plus derived fields (resolved version, authors, timestamps, visibility). A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:rHH1177g -->

This document describes the **seed-document** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:QZ19vXgV -->

# Shape <!-- id:K1d3WkMR -->

A **closed struct** with these fields: <!-- id:OhtHahKP -->
  - `content` — list of [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:-PA1LHI- -->
  - `version` — [string](./onyx-string.md) <!-- id:PA6phMO_ -->
  - `account` — [string](./onyx-string.md) <!-- id:vwB-pjkc -->
  - `authors` _(required)_ — list of [string](./onyx-string.md) <!-- id:rv5pKRN_ -->
  - `path` — [string](./onyx-string.md) <!-- id:mwCn1Kvo -->
  - `createTime` — one of [hypermedia-timestamp](./hypermedia-timestamp.md) | [string](./onyx-string.md) <!-- id:gLksy_CJ -->
  - `updateTime` — one of [hypermedia-timestamp](./hypermedia-timestamp.md) | [string](./onyx-string.md) <!-- id:eDxwGcV- -->
  - `metadata` _(required)_ — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:1Y7BoAam -->
  - `detachedBlocks` — map ⟨ \* : [hypermedia-block-node](./hypermedia-block-node.md) ⟩ <!-- id:vxG3_Pnt -->
  - `genesis` _(required)_ — [string](./onyx-string.md) <!-- id:X1W8zxVF -->
  - `generationInfo` — map { 2 fields } <!-- id:E5l0dJfG -->
  - `visibility` _(required)_ — [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:kQ4F7_rH -->

# Depends on <!-- id:Kt0TNJmF -->

- [hypermedia-block-node](./hypermedia-block-node.md) <!-- id:8Mhlq5zn -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:ANUW1WZR -->
- [hypermedia-timestamp](./hypermedia-timestamp.md) <!-- id:GGHALg_c -->
- [hypermedia-visibility](./hypermedia-visibility.md) <!-- id:mE3ezOcN -->
- [integer](./onyx-integer.md) <!-- id:lK3bWake -->
- [string](./onyx-string.md) <!-- id:qVYchjv5 -->
