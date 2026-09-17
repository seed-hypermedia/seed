---
name: Place
summary: "A world-builder page type for a place, whose attributes require a kind and may add a founding date, a parent region, and a coordinates object."
schemaDefinition: ipfs://bafyreif2ualrqd5jryfqgwd3yhgocrc7zewjkj3lldtagt2pvbd3qzjzhm
---
A world-builder kit type: a page about a place. Its attributes require a `kind`, may carry a `founded` date, nest inside a `region` (another Place), and link to a coordinates object (an `ipfs://` object conforming to Geo point). <!-- id:7NTBcQkU -->

This document describes the **example/place-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zeQyDg6y -->

# Shape <!-- id:GLZCFflE -->

A **closed struct** with these fields: <!-- id:Ow0yN6aL -->
  - `kind` _(required)_ — [string](../string.md) (one of `city`, `town`, `village`, `fortress`, `ruin`, `wilderness`, `realm`) <!-- id:hAd13nXH -->
  - `founded` — [date](../date.md) <!-- id:8wxCKl6h -->
  - `region` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ATWV_Ckx -->
  - `ruler` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:-eI6xxf1 -->
  - `coordinates` — [ipfs-url](../ipfs-url.md) (→ must conform to [example/geo](./geo.md)) <!-- id:nC4HPPfr -->
  - `map` — [ipfs-url](../ipfs-url.md) <!-- id:BAH0mMmh -->

# Depends on <!-- id:SfnIopYv -->

- [hm-url](../hm-url.md) <!-- id:RAGKg-_U -->
- [ipfs-url](../ipfs-url.md) <!-- id:AWDpWFLU -->
- [date](../date.md) <!-- id:-lpQetBo -->
- [string](../string.md) <!-- id:4eJ_Aidm -->
