---
name: Parsed ID
summary: "A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carr"
schemaDefinition: ipfs://bafyreibv4covkpgd4zadhkuvepzdec4h43ra2x2mjkhatmfxjj7atrnmym
---
A parsed hm:// identifier as clients pass it around: account uid, path segments, pinned version, block reference, and origin hints. Fields the URL does not carry are null. A derived read model computed by the Seed daemon/API for clients — not a signed network blob. <!-- id:_G2YLDZ8 -->

This document describes the **rpc/type/id** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:XTZhL1KF -->

# Shape <!-- id:dv0g4WNA -->

A **closed struct** with these fields: <!-- id:fh7Sxe0r -->
  - `id` _(required)_ — [string](../../string.md) <!-- id:fskPAU7S -->
  - `uid` _(required)_ — [string](../../string.md) <!-- id:XfHXweTr -->
  - `path` _(required)_ — one of list of [string](../../string.md) | [null](../../null.md) <!-- id:B8EHAbPu -->
  - `version` _(required)_ — one of [string](../../string.md) | [null](../../null.md) <!-- id:pib8La4i -->
  - `blockRef` _(required)_ — one of [string](../../string.md) | [null](../../null.md) <!-- id:ZNfUNSa6 -->
  - `blockRange` _(required)_ — one of [rpc/type/block-range](./block-range.md) | [null](../../null.md) <!-- id:g9HesrHj -->
  - `hostname` _(required)_ — one of [string](../../string.md) | [null](../../null.md) <!-- id:-103U5pY -->
  - `scheme` _(required)_ — one of [string](../../string.md) | [null](../../null.md) <!-- id:RXYVaFte -->
  - `latest` — one of [boolean](../../boolean.md) | [null](../../null.md) <!-- id:Nxnyb22b -->

# Depends on <!-- id:gwqKPqVh -->

- [boolean](../../boolean.md) <!-- id:yqoRG8aN -->
- [null](../../null.md) <!-- id:Wl4BhCsF -->
- [string](../../string.md) <!-- id:n_YOHrze -->
- [rpc/type/block-range](./block-range.md) <!-- id:dTVQ_nVA -->
