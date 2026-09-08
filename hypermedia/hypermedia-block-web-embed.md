---
name: Web embed block
summary: An embed of an external web resource (an http(s) URL).
schemaDefinition: ipfs://bafyreigfkgywqcorbvlfraz56msc2c75foyx7eexqwvo2vcjp75sorikk4
---
This document describes the **hypermedia-block-web-embed** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XGtQTo6l -->

# Shape <!-- id:Q5buqKEc -->

**Extends** [hypermedia-block-base](./hypermedia-block-base.md) with these added fields: <!-- id:smg-tBbR -->
  - `type` — `"WebEmbed"` <!-- id:c2wlVeW6 -->
  - `link` _(required)_ — [string](./hypermedia-string.md) <!-- id:-den0FTt -->

# Depends on <!-- id:U9-iiqv6 -->

- [hypermedia-block-base](./hypermedia-block-base.md) <!-- id:aptiE36d -->
- [string](./hypermedia-string.md) <!-- id:vCCkhfdX -->
