---
name: Character
summary: A world-builder page type for a character, whose attributes require a birth date and a role and link to a home place, a faction, a portrait, and a stats object.
---
A [World Builder](../schema/world-builder.md) page type for a character. Its [attributes](../schema/typed-documents.md) require a `born` [date](../date.md) and a `role`. They link the character to a home [place](./place-doc.md) and a [faction](./faction-doc.md) with [hm:// URLs](../hm-url.md), and to a portrait file and a [stats](./stats.md) object with [ipfs:// URLs](../ipfs-url.md). The stats object must conform to `example/stats`. `notes` is an untyped object link that holds any [DAG-CBOR](../schema/dag-cbor.md) value. <!-- id:QPklbVhv -->

This page describes the **example/character-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:r80voeuc -->

# See also <!-- id:HQ5r50aP -->

- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:gRABJ8Kj -->
- [stats](./stats.md): the linked stats object. <!-- id:UW7s8Mq7 -->
- [place-doc](./place-doc.md): the home place type. <!-- id:nf9bq0Zf -->
- [Typed documents](../schema/typed-documents.md): how a page names its type. <!-- id:biu4VWjN -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:zWjAr4JZ -->
