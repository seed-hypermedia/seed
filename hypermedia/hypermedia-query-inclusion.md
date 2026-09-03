---
name: Query inclusion
summary: "One source a Query block pulls documents from: a space (account), an optional path prefix inside it, and whether to list direct Children or AllDescendants."
schemaDefinition: ipfs://bafyreigcth62qjk727fpqndfbjok7lq36p244uunxjbk75h7vfebjkzt2y
---
This document describes the **hypermedia-query-inclusion** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:FNiZQ7M3 -->

# Shape <!-- id:dNz8ygnf -->

A **closed struct** with these fields: <!-- id:6nE0LZik -->
  - `space` _(required)_ — [string](./onyx-string.md) <!-- id:_Oh8MBbr -->
  - `path` — [string](./onyx-string.md) <!-- id:9WR91zo6 -->
  - `mode` _(required)_ — `string` enum: `Children` `AllDescendants` <!-- id:7v3c9tNP -->

# Depends on <!-- id:NBioyAez -->

- [string](./onyx-string.md) <!-- id:y2iLFCcl -->
