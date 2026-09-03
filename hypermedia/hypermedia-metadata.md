---
name: Document metadata
summary: "Resolved document metadata (merged from Change ops): known keys plus arbitrary extras."
schemaDefinition: ipfs://bafyreiegxdt7lg4awaa5mjh2dvbw4l7u3uvljnky3t3gvjvdl23aq6zzfe
---
This document describes the **hypermedia-metadata** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LCMEm3AK -->

# Shape <!-- id:-ix8zCqi -->

A map with these fields: <!-- id:L2SJyGsk -->
  - `name` — [string](./onyx-string.md) <!-- id:A-W8DLNa -->
  - `summary` — [string](./onyx-string.md) <!-- id:3LriHtp0 -->
  - `icon` — [string](./onyx-string.md) <!-- id:6dGrRIdx -->
  - `cover` — [string](./onyx-string.md) <!-- id:zjUSdmH1 -->
  - `siteUrl` — [string](./onyx-string.md) <!-- id:PyLw_CMi -->
  - `schema` — [string](./onyx-string.md) <!-- id:ADiIVpjJ -->
  - `childrenSchema` — [string](./onyx-string.md) <!-- id:UONmILsQ -->
  - `schemaDefinition` — [string](./onyx-string.md) <!-- id:ZUbSthmD -->
  - `layout` — `string` enum: `Seed/Experimental/Newspaper`\  <!-- id:I-9Xt4-i -->
  - `displayPublishTime` — [string](./onyx-string.md) <!-- id:t_InI3WT -->
  - `displayAuthor` — [string](./onyx-string.md) <!-- id:b3VkN4qc -->
  - `showOutline` — [boolean](./onyx-boolean.md) <!-- id:PGeCxMgg -->
  - `showActivity` — [boolean](./onyx-boolean.md) <!-- id:Rfm2qV8U -->
  - `contentWidth` — `string` enum: `S` `M` `L` <!-- id:8si9AhAF -->
  - `childrenType` — [string](./onyx-string.md) <!-- id:-HIIWHMr -->
  - `theme` — map { 1 fields } <!-- id:Gz2wxX6C -->

# Depends on <!-- id:ZvzKpaKj -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:9xa9orX2 -->
- [boolean](./onyx-boolean.md) <!-- id:iyrNR-f0 -->
- [string](./onyx-string.md) <!-- id:W8yIt82N -->
