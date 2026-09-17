---
name: Character
summary: "A world-builder page type for a character, whose attributes require a birth date and a role and link to a home place, a faction, a portrait, and a stats object."
schemaDefinition: ipfs://bafyreicvvxzsyz4y3brn4w7mf57zcy2oevhyoeuesvffqag5wdqqafw3oq
---
A world-builder kit type: a page about a character. Its attributes require a `born` date and a `role`, and links the character to a home place, a faction, a portrait file, and a stats object (an `ipfs://` object that must conform to `example/stats`). `notes` is an untyped object link — any DAG-CBOR value. <!-- id:QPklbVhv -->

This document describes the **example/character-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:r80voeuc -->

# Shape <!-- id:NsyiqGRx -->

A **closed struct** with these fields: <!-- id:dms8pLir -->
  - `born` _(required)_ — [date](../date.md) <!-- id:vp7r1oom -->
  - `died` — [date](../date.md) <!-- id:FVu4DYEh -->
  - `role` _(required)_ — [string](../string.md) (one of `hero`, `villain`, `ally`, `neutral`) <!-- id:T6HNkFTq -->
  - `home` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:JXWL2Q9D -->
  - `faction` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:zCsjF9s1 -->
  - `portrait` — [ipfs-url](../ipfs-url.md) <!-- id:m1jXdIZe -->
  - `stats` — [ipfs-url](../ipfs-url.md) (→ must conform to [example/stats](./stats.md)) <!-- id:DersQtST -->
  - `notes` — [ipfs-url](../ipfs-url.md) <!-- id:6MxBywUM -->

# Depends on <!-- id:wfF6wZQt -->

- [hm-url](../hm-url.md) <!-- id:pjGd9151 -->
- [ipfs-url](../ipfs-url.md) <!-- id:_5Lorpsh -->
- [date](../date.md) <!-- id:d2oM-6Id -->
- [string](../string.md) <!-- id:eAML1B3O -->
