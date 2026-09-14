---
name: Place
summary: "A world-builder kit type: a page about a place. Its attributes require a `kind`, may carry a `founded` date, nest inside a `region` (another Place), a"
schemaDefinition: ipfs://bafyreihjun4m3ovalfibawnry7y7o4hxziwcwncvb3wt6w3ccjmeswafni
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
