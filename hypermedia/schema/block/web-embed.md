---
name: Web Embed Block
summary: An embed of an external web resource (an http(s) URL).
schemaDefinition: ipfs://bafyreigk6moj2sllyu2rjdlxiep6h3dw5moyil5oltvcn6gc55wmu6nj4e
---
This document describes the **schema/block/web-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XGtQTo6l -->

# Shape <!-- id:Q5buqKEc -->

**Extends** [schema/block/base](./base.md) with these added fields: <!-- id:smg-tBbR -->
  - `type` — `"WebEmbed"` <!-- id:c2wlVeW6 -->
  - `link` _(required)_ — [string](../string.md) <!-- id:-den0FTt -->

# Depends on <!-- id:U9-iiqv6 -->

- [schema/block/base](./base.md) <!-- id:aptiE36d -->
- [string](../string.md) <!-- id:vCCkhfdX -->
