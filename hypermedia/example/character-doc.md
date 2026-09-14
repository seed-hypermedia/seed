---
name: Character
summary: "A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a ho"
schemaDefinition: ipfs://bafyreid44lmzbik26yebmodjueha3g3ex26a2pu3xgatawisyy5m5aiql4
---
A world-builder kit type: a page about a character. Extends the base document; its metadata requires a `born` date and a `role`, and links the character to a home place, a faction, a portrait file, and a stats object (an `ipfs://` object that must conform to `example/stats`). `notes` is an untyped object link — any DAG-CBOR value. <!-- id:QPklbVhv -->

This document describes the **example/character-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:r80voeuc -->

# Shape <!-- id:NsyiqGRx -->

**Extends** [document](../document.md) with these added fields: <!-- id:dms8pLir -->
  - `metadata` — [metadata](../metadata.md) <!-- id:JOOTyEPu -->
  - _adds to [metadata](../metadata.md):_ <!-- id:6gtVbCM_ -->
  - `born` _(required)_ — [date](../schema/date.md) <!-- id:vp7r1oom -->
  - `died` — [date](../schema/date.md) <!-- id:FVu4DYEh -->
  - `role` _(required)_ — [string](../schema/string.md) (one of `hero`, `villain`, `ally`, `neutral`) <!-- id:T6HNkFTq -->
  - `home` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:JXWL2Q9D -->
  - `faction` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:zCsjF9s1 -->
  - `portrait` — [schema/ipfs](../schema/ipfs.md) <!-- id:m1jXdIZe -->
  - `stats` — [schema/ipfs](../schema/ipfs.md) (→ must conform to [example/stats](./stats.md)) <!-- id:DersQtST -->
  - `notes` — [schema/ipfs](../schema/ipfs.md) <!-- id:6MxBywUM -->

# Depends on <!-- id:wfF6wZQt -->

- [document](../document.md) <!-- id:W6EghLGO -->
- [hm-url](../hm-url.md) <!-- id:pjGd9151 -->
- [schema/ipfs](../schema/ipfs.md) <!-- id:_5Lorpsh -->
- [metadata](../metadata.md) <!-- id:JXfDl0-Y -->
- [date](../schema/date.md) <!-- id:d2oM-6Id -->
- [string](../schema/string.md) <!-- id:eAML1B3O -->
