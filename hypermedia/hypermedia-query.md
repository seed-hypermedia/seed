---
name: Query
summary: "A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Q"
schemaDefinition: ipfs://bafyreihgbr4dhuntqvtnw5r2ybd4pih3fdjerudrivdtcohacuryofzc6i
---
A live document query: which spaces/paths to include, how to sort, and an optional result limit. Embedded in a Query block's attributes; also the input of the Query API. <!-- id:rWL5NDLS -->

This document describes the **hypermedia-query** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Rj8kS1xf -->

# Shape <!-- id:lq2339R1 -->

A **closed struct** with these fields: <!-- id:2wTIZ4R0 -->
  - `includes` _(required)_ — list of [hypermedia-query-inclusion](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-inclusion) <!-- id:dsd-GXt3 -->
  - `sort` — list of [hypermedia-query-sort](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-sort) <!-- id:OV-3krlD -->
  - `limit` — `integer` <!-- id:oioonYyE -->

# Depends on <!-- id:pvslUZ8E -->

- [hypermedia-query-inclusion](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-inclusion) <!-- id:Yva40J_Y -->
- [hypermedia-query-sort](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query-sort) <!-- id:yQzR9VU3 -->
