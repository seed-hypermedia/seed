---
name: Parsed ID
summary: "A parsed hm:// identifier as clients pass it around (account uid, path segments, pinned version, block reference, origin hints), with null for whatever the URL does not carry."
schemaDefinition: ipfs://bafyreibv4covkpgd4zadhkuvepzdec4h43ra2x2mjkhatmfxjj7atrnmym
---
A parsed [hm:// URL](../../protocol/urls.md) as clients pass it around: [account](../../protocol/identity.md) uid, path segments, pinned [version](../../protocol/documents.md), [block](../../protocol/blocks.md) reference and origin hints. Fields the URL does not carry are `null`. <!-- id:_G2YLDZ8 -->

This page describes the **rpc/type/id** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:XTZhL1KF -->

# Shape <!-- id:dv0g4WNA -->

A **closed struct** with these fields: <!-- id:fh7Sxe0r -->
  - `id` _(required)_: [string](../../string.md) <!-- id:fskPAU7S -->
  - `uid` _(required)_: [string](../../string.md) <!-- id:XfHXweTr -->
  - `path` _(required)_: one of list of [string](../../string.md) | [null](../../null.md) <!-- id:B8EHAbPu -->
  - `version` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:pib8La4i -->
  - `blockRef` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:ZNfUNSa6 -->
  - `blockRange` _(required)_: one of [rpc/type/block-range](./block-range.md) | [null](../../null.md) <!-- id:g9HesrHj -->
  - `hostname` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:-103U5pY -->
  - `scheme` _(required)_: one of [string](../../string.md) | [null](../../null.md) <!-- id:RXYVaFte -->
  - `latest`: one of [boolean](../../boolean.md) | [null](../../null.md) <!-- id:Nxnyb22b -->

# Depends on <!-- id:gwqKPqVh -->

- [boolean](../../boolean.md) <!-- id:yqoRG8aN -->
- [null](../../null.md) <!-- id:Wl4BhCsF -->
- [string](../../string.md) <!-- id:n_YOHrze -->
- [rpc/type/block-range](./block-range.md) <!-- id:dTVQ_nVA -->

# See also

- [Hypermedia URLs](../../protocol/urls.md): the URL format.
- [Block Range](./block-range.md): the range inside a block reference.
- [Resource](../resource.md): the method that takes a parsed id.
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models.
