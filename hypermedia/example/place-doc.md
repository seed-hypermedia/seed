---
name: Place
summary: "A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links t"
schemaDefinition: ipfs://bafyreibv2sirt4cebioi2l47hebryot6xfkb3ve44zyhxrcpw7mbeiwk2u
---
A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links to a coordinates object (an `ipfs://` object conforming to Geo point). <!-- id:7NTBcQkU -->

This document describes the **example/place-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zeQyDg6y -->

# Shape <!-- id:GLZCFflE -->

**Extends** [document](../document.md) with these added fields: <!-- id:Ow0yN6aL -->
  - `metadata` — [metadata](../metadata.md) <!-- id:NohtRnDF -->
  - _adds to [metadata](../metadata.md):_ <!-- id:ih-LZGxF -->
  - `kind` _(required)_ — [string](../schema/string.md) (one of `city`, `town`, `village`, `fortress`, `ruin`, `wilderness`, `realm`) <!-- id:hAd13nXH -->
  - `founded` — [date](../schema/date.md) <!-- id:8wxCKl6h -->
  - `region` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ATWV_Ckx -->
  - `ruler` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:-eI6xxf1 -->
  - `coordinates` — [schema/ipfs](../schema/ipfs.md) (→ must conform to [example/geo](./geo.md)) <!-- id:nC4HPPfr -->
  - `map` — [schema/ipfs](../schema/ipfs.md) <!-- id:BAH0mMmh -->

# Depends on <!-- id:SfnIopYv -->

- [document](../document.md) <!-- id:w7WYD0Q5 -->
- [hm-url](../hm-url.md) <!-- id:RAGKg-_U -->
- [schema/ipfs](../schema/ipfs.md) <!-- id:AWDpWFLU -->
- [metadata](../metadata.md) <!-- id:VB7bQUjL -->
- [date](../schema/date.md) <!-- id:-lpQetBo -->
- [string](../schema/string.md) <!-- id:4eJ_Aidm -->
