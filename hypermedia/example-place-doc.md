---
name: Place
summary: "A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links t"
schemaDefinition: ipfs://bafyreibhlv722wypyx7nqccbdwrjxtpyrwyhlfpwkfbirh5xzu3t4377h4
---
A world-builder kit type: a page about a place. Its metadata requires a `kind`, may carry a `founded` date, nests inside a `region` (another Place), and links to a coordinates object (an `ipfs://` object conforming to Geo point). <!-- id:7NTBcQkU -->

This document describes the **example-place-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zeQyDg6y -->

# Shape <!-- id:GLZCFflE -->

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:Ow0yN6aL -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:NohtRnDF -->
  - _adds to [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata):_ <!-- id:ih-LZGxF -->
  - `kind` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) (one of `city`, `town`, `village`, `fortress`, `ruin`, `wilderness`, `realm`) <!-- id:hAd13nXH -->
  - `founded` — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:8wxCKl6h -->
  - `region` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-place-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc)) <!-- id:ATWV_Ckx -->
  - `ruler` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-faction-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-faction-doc)) <!-- id:-eI6xxf1 -->
  - `coordinates` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) (→ must conform to [example-geo](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-geo)) <!-- id:nC4HPPfr -->
  - `map` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:BAH0mMmh -->

# Depends on <!-- id:SfnIopYv -->

- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:w7WYD0Q5 -->
- [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) <!-- id:RAGKg-_U -->
- [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:AWDpWFLU -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:VB7bQUjL -->
- [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:-lpQetBo -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:4eJ_Aidm -->
