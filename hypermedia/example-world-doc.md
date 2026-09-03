---
name: World
summary: "A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events;"
schemaDefinition: ipfs://bafyreicxg6z5pggwdqq5ifgi37rw2754hwx2hlaqofhx66ijrzfd2ffz5m
---
A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events; its metadata names the genre and the date the chronicle begins. <!-- id:tWJgX3A2 -->

This document describes the **example-world-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:afUtpf0w -->

# Shape <!-- id:f1KbJ2ci -->
**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:qfyt9Gtj -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:0iNrXaS0 -->
  - _adds to [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata):_ <!-- id:r0KTtnBZ -->
  - `genre` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) (one of `fantasy`, `science-fiction`, `historical`, `contemporary`, `mythic`) <!-- id:0ujhBQvU -->
  - `epoch` — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:U_Ww1oVZ -->
  - `tagline` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:JSSPut80 -->

# Depends on <!-- id:isqmdDcM -->
- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:HZ4iDpUw -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:w3N25OWp -->
- [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:vd6ctMNl -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:3hGaivVk -->