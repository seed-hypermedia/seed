---
name: Document Metadata
summary: "Resolved document metadata (merged from Change ops): known keys plus arbitrary extras."
schemaDefinition: ipfs://bafyreiegh55aibiyvxbuxjxadl34jtaijaf5owd4asgdbv3mfsct5qp5eq
---
This document describes the **metadata** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LCMEm3AK -->

# Shape <!-- id:-ix8zCqi -->

A map with these fields: <!-- id:L2SJyGsk -->
  - `name` — [string](./string.md) <!-- id:A-W8DLNa -->
  - `summary` — [string](./string.md) <!-- id:3LriHtp0 -->
  - `icon` — [string](./string.md) <!-- id:6dGrRIdx -->
  - `cover` — [string](./string.md) <!-- id:zjUSdmH1 -->
  - `siteUrl` — [string](./string.md) <!-- id:PyLw_CMi -->
  - `schema` — [string](./string.md) <!-- id:ADiIVpjJ -->
  - `childrenSchema` — [string](./string.md) <!-- id:UONmILsQ -->
  - `schemaDefinition` — [string](./string.md) <!-- id:ZUbSthmD -->
  - `layout` — `"Seed/Experimental/Newspaper"` <!-- id:I-9Xt4-i -->
  - `displayPublishTime` — [string](./string.md) <!-- id:t_InI3WT -->
  - `displayAuthor` — [string](./string.md) <!-- id:b3VkN4qc -->
  - `showOutline` — [boolean](./boolean.md) <!-- id:PGeCxMgg -->
  - `showActivity` — [boolean](./boolean.md) <!-- id:Rfm2qV8U -->
  - `contentWidth` — one of `"S"` | `"M"` | `"L"` <!-- id:8si9AhAF -->
  - `childrenType` — [string](./string.md) <!-- id:-HIIWHMr -->
  - `theme` — map { 1 fields } <!-- id:Gz2wxX6C -->

# Depends on <!-- id:ZvzKpaKj -->

- [value](./value.md) <!-- id:9xa9orX2 -->
- [boolean](./boolean.md) <!-- id:iyrNR-f0 -->
- [string](./string.md) <!-- id:W8yIt82N -->
