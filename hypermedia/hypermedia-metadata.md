---
name: Document metadata
summary: "Resolved document metadata (merged from Change ops): known keys plus arbitrary extras."
schemaDefinition: ipfs://bafyreicqsfidxkypckqem7tikfxpocg5njaeawnxuffn7afod7vn4lf34u
---
This document describes the **hypermedia-metadata** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LCMEm3AK -->

# Shape <!-- id:-ix8zCqi -->

A map with these fields: <!-- id:L2SJyGsk -->
  - `name` — [string](./hypermedia-string.md) <!-- id:A-W8DLNa -->
  - `summary` — [string](./hypermedia-string.md) <!-- id:3LriHtp0 -->
  - `icon` — [string](./hypermedia-string.md) <!-- id:6dGrRIdx -->
  - `cover` — [string](./hypermedia-string.md) <!-- id:zjUSdmH1 -->
  - `siteUrl` — [string](./hypermedia-string.md) <!-- id:PyLw_CMi -->
  - `schema` — [string](./hypermedia-string.md) <!-- id:ADiIVpjJ -->
  - `childrenSchema` — [string](./hypermedia-string.md) <!-- id:UONmILsQ -->
  - `schemaDefinition` — [string](./hypermedia-string.md) <!-- id:ZUbSthmD -->
  - `layout` — `string` enum: `Seed/Experimental/Newspaper`\  <!-- id:I-9Xt4-i -->
  - `displayPublishTime` — [string](./hypermedia-string.md) <!-- id:t_InI3WT -->
  - `displayAuthor` — [string](./hypermedia-string.md) <!-- id:b3VkN4qc -->
  - `showOutline` — [boolean](./hypermedia-boolean.md) <!-- id:PGeCxMgg -->
  - `showActivity` — [boolean](./hypermedia-boolean.md) <!-- id:Rfm2qV8U -->
  - `contentWidth` — `string` enum: `S` `M` `L` <!-- id:8si9AhAF -->
  - `childrenType` — [string](./hypermedia-string.md) <!-- id:-HIIWHMr -->
  - `theme` — map { 1 fields } <!-- id:Gz2wxX6C -->

# Depends on <!-- id:ZvzKpaKj -->

- [hypermedia-value](./hypermedia-value.md) <!-- id:9xa9orX2 -->
- [boolean](./hypermedia-boolean.md) <!-- id:iyrNR-f0 -->
- [string](./hypermedia-string.md) <!-- id:W8yIt82N -->
