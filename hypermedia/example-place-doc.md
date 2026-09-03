---
name: Place
summary: "A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links t"
schemaDefinition: ipfs://bafyreiduwnimlgezp3kdqloj2u6d4ly3h5izbayzgixxahxmorxv7wykpu
---
A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links to a coordinates object (an `ipfs://` object conforming to Geo point). <!-- id:7NTBcQkU -->

This document describes the **example-place-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zeQyDg6y -->

# Shape <!-- id:GLZCFflE -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:Ow0yN6aL -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:NohtRnDF -->
  - _adds to [hypermedia-metadata](./hypermedia-metadata.md):_ <!-- id:ih-LZGxF -->
  - `kind` _(required)_ — [string](./onyx-string.md) (one of `city`, `town`, `village`, `fortress`, `ruin`, `wilderness`, `realm`) <!-- id:hAd13nXH -->
  - `founded` — [date](./onyx-date.md) <!-- id:8wxCKl6h -->
  - `region` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-place-doc](./example-place-doc.md)) <!-- id:ATWV_Ckx -->
  - `ruler` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-faction-doc](./example-faction-doc.md)) <!-- id:-eI6xxf1 -->
  - `coordinates` — [hypermedia-ipfs](./hypermedia-ipfs.md) (→ must conform to [example-geo](./example-geo.md)) <!-- id:nC4HPPfr -->
  - `map` — [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:BAH0mMmh -->

# Depends on <!-- id:SfnIopYv -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:w7WYD0Q5 -->
- [hypermedia-hm-url](./hypermedia-hm-url.md) <!-- id:RAGKg-_U -->
- [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:AWDpWFLU -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:VB7bQUjL -->
- [date](./onyx-date.md) <!-- id:-lpQetBo -->
- [string](./onyx-string.md) <!-- id:4eJ_Aidm -->
