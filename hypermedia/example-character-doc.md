---
name: Character
summary: "A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a ho"
schemaDefinition: ipfs://bafyreibuzqvotme3rl4f5tlwxu6srjtkexujkbfy6hwm5vbsuzkkxvutoi
---
A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a home place, a faction, a portrait file, and a stats object (an `ipfs://` object that must conform to `example-stats`). `notes` is an untyped object link — any DAG-CBOR value. <!-- id:QPklbVhv -->

This document describes the **example-character-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:r80voeuc -->

# Shape <!-- id:NsyiqGRx -->

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:dms8pLir -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:JOOTyEPu -->
  - _adds to [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata):_ <!-- id:6gtVbCM_ -->
  - `born` _(required)_ — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:vp7r1oom -->
  - `died` — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:FVu4DYEh -->
  - `role` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) (one of `hero`, `villain`, `ally`, `neutral`) <!-- id:T6HNkFTq -->
  - `home` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-place-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc)) <!-- id:JXWL2Q9D -->
  - `faction` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-faction-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-faction-doc)) <!-- id:zCsjF9s1 -->
  - `portrait` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:m1jXdIZe -->
  - `stats` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) (→ must conform to [example-stats](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-stats)) <!-- id:DersQtST -->
  - `notes` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:6MxBywUM -->

# Depends on <!-- id:wfF6wZQt -->

- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:W6EghLGO -->
- [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) <!-- id:pjGd9151 -->
- [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:_5Lorpsh -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:JXfDl0-Y -->
- [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:d2oM-6Id -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:eAML1B3O -->
