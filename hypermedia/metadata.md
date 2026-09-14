---
name: Document metadata
summary: "Resolved document metadata (merged from Change ops): known keys plus arbitrary extras."
schemaDefinition: ipfs://bafyreifkb4z4yjpwhaiebqe7765ar7626x2fz6pgv6bjapcoorhxutot6q
---
This document describes the **metadata** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LCMEm3AK -->

# Shape <!-- id:-ix8zCqi -->

A map with these fields: <!-- id:L2SJyGsk -->
  - `name` — [string](./schema/string.md) <!-- id:A-W8DLNa -->
  - `summary` — [string](./schema/string.md) <!-- id:3LriHtp0 -->
  - `icon` — [string](./schema/string.md) <!-- id:6dGrRIdx -->
  - `cover` — [string](./schema/string.md) <!-- id:zjUSdmH1 -->
  - `siteUrl` — [string](./schema/string.md) <!-- id:PyLw_CMi -->
  - `schema` — [string](./schema/string.md) <!-- id:ADiIVpjJ -->
  - `childrenSchema` — [string](./schema/string.md) <!-- id:UONmILsQ -->
  - `schemaDefinition` — [string](./schema/string.md) <!-- id:ZUbSthmD -->
  - `layout` — `"Seed/Experimental/Newspaper"` <!-- id:I-9Xt4-i -->
  - `displayPublishTime` — [string](./schema/string.md) <!-- id:t_InI3WT -->
  - `displayAuthor` — [string](./schema/string.md) <!-- id:b3VkN4qc -->
  - `showOutline` — [boolean](./schema/boolean.md) <!-- id:PGeCxMgg -->
  - `showActivity` — [boolean](./schema/boolean.md) <!-- id:Rfm2qV8U -->
  - `contentWidth` — one of `"S"` | `"M"` | `"L"` <!-- id:8si9AhAF -->
  - `childrenType` — [string](./schema/string.md) <!-- id:-HIIWHMr -->
  - `theme` — map { 1 fields } <!-- id:Gz2wxX6C -->

# Depends on <!-- id:ZvzKpaKj -->

- [schema/value](./schema/value.md) <!-- id:9xa9orX2 -->
- [boolean](./schema/boolean.md) <!-- id:iyrNR-f0 -->
- [string](./schema/string.md) <!-- id:W8yIt82N -->
