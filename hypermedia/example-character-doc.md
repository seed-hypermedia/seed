---
name: Character
summary: "A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a ho"
schemaDefinition: ipfs://bafyreibakwjv2w6ww5z3h6u7znszbqcm6fkf24ub4ruwiopx5owrce2a2y
---
A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a home place, a faction, a portrait file, and a stats object (an `ipfs://` object that must conform to `example-stats`). `notes` is an untyped object link — any DAG-CBOR value. <!-- id:QPklbVhv -->

This document describes the **example-character-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:r80voeuc -->

# Shape <!-- id:NsyiqGRx -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:dms8pLir -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:JOOTyEPu -->
  - _adds to [hypermedia-metadata](./hypermedia-metadata.md):_ <!-- id:6gtVbCM_ -->
  - `born` _(required)_ — [date](./onyx-date.md) <!-- id:vp7r1oom -->
  - `died` — [date](./onyx-date.md) <!-- id:FVu4DYEh -->
  - `role` _(required)_ — [string](./onyx-string.md) (one of `hero`, `villain`, `ally`, `neutral`) <!-- id:T6HNkFTq -->
  - `home` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-place-doc](./example-place-doc.md)) <!-- id:JXWL2Q9D -->
  - `faction` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-faction-doc](./example-faction-doc.md)) <!-- id:zCsjF9s1 -->
  - `portrait` — [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:m1jXdIZe -->
  - `stats` — [hypermedia-ipfs](./hypermedia-ipfs.md) (→ must conform to [example-stats](./example-stats.md)) <!-- id:DersQtST -->
  - `notes` — [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:6MxBywUM -->

# Depends on <!-- id:wfF6wZQt -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:W6EghLGO -->
- [hypermedia-hm-url](./hypermedia-hm-url.md) <!-- id:pjGd9151 -->
- [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:_5Lorpsh -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:JXfDl0-Y -->
- [date](./onyx-date.md) <!-- id:d2oM-6Id -->
- [string](./onyx-string.md) <!-- id:eAML1B3O -->
