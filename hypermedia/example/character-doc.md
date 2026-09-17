---
name: Character
summary: A world-builder page type for a character, whose attributes require a birth date and a role and link to a home place, a faction, a portrait, and a stats object.
schemaDefinition: ipfs://bafyreicvvxzsyz4y3brn4w7mf57zcy2oevhyoeuesvffqag5wdqqafw3oq
---
A [World Builder](../schema/world-builder.md) page type for a character. Its [attributes](../schema/typed-documents.md) require a `born` [date](../date.md) and a `role`. They link the character to a home [place](./place-doc.md) and a [faction](./faction-doc.md) with [hm:// URLs](../hm-url.md), and to a portrait file and a [stats](./stats.md) object with [ipfs:// URLs](../ipfs-url.md). The stats object must conform to `example/stats`. `notes` is an untyped object link that holds any [DAG-CBOR](../schema/dag-cbor.md) value. <!-- id:QPklbVhv -->

This page describes the **example/character-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:r80voeuc -->

# Shape <!-- id:NsyiqGRx -->

A **closed struct** with these fields: <!-- id:dms8pLir -->
  - `born` _(required)_: [date](../date.md) <!-- id:vp7r1oom -->
  - `died`: [date](../date.md) <!-- id:FVu4DYEh -->
  - `role` _(required)_: [string](../string.md) (one of `hero`, `villain`, `ally`, `neutral`) <!-- id:T6HNkFTq -->
  - `home`: [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:JXWL2Q9D -->
  - `faction`: [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:zCsjF9s1 -->
  - `portrait`: [ipfs-url](../ipfs-url.md) <!-- id:m1jXdIZe -->
  - `stats`: [ipfs-url](../ipfs-url.md) (→ must conform to [example/stats](./stats.md)) <!-- id:DersQtST -->
  - `notes`: [ipfs-url](../ipfs-url.md) <!-- id:6MxBywUM -->

# Depends on <!-- id:wfF6wZQt -->

- [hm-url](../hm-url.md) <!-- id:pjGd9151 -->
- [ipfs-url](../ipfs-url.md) <!-- id:_5Lorpsh -->
- [date](../date.md) <!-- id:d2oM-6Id -->
- [string](../string.md) <!-- id:eAML1B3O -->

# See also <!-- id:HQ5r50aP -->

- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:gRABJ8Kj -->
- [stats](./stats.md): the linked stats object. <!-- id:UW7s8Mq7 -->
- [place-doc](./place-doc.md): the home place type. <!-- id:nf9bq0Zf -->
- [Typed documents](../schema/typed-documents.md): how a page names its type. <!-- id:biu4VWjN -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:zWjAr4JZ -->
