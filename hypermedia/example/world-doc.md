---
name: World
summary: A world-builder page type for the root of a fictional world, whose children hold the type definitions and the folders of characters, places, factions, and events.
schemaDefinition: ipfs://bafyreihszwaw2sq3ujjsrjqqrwo2lasp3qml3y5gj5byo3iuyzuhnrkh4e
---
A [World Builder](../schema/world-builder.md) page type for the root of a fictional world. Its children are the type definitions and the folders of [characters](./character-doc.md), [places](./place-doc.md), [factions](./faction-doc.md) and [events](./event-doc.md). Its [attributes](../schema/typed-documents.md) name the genre and the date the chronicle begins. <!-- id:tWJgX3A2 -->

This page describes the **example/world-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:afUtpf0w -->

# Shape <!-- id:f1KbJ2ci -->

A **closed struct** with these fields: <!-- id:qfyt9Gtj -->
  - `genre` _(required)_: [string](../string.md) (one of `fantasy`, `science-fiction`, `historical`, `contemporary`, `mythic`) <!-- id:0ujhBQvU -->
  - `epoch`: [date](../date.md) <!-- id:U_Ww1oVZ -->
  - `tagline`: [string](../string.md) <!-- id:JSSPut80 -->

# Depends on <!-- id:isqmdDcM -->

- [date](../date.md) <!-- id:vd6ctMNl -->
- [string](../string.md) <!-- id:3hGaivVk -->

# See also <!-- id:fx6J_FpV -->

- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:cvHNdJ9x -->
- [character-doc](./character-doc.md): the character type. <!-- id:5RReBdQd -->
- [Typed documents](../schema/typed-documents.md): how a page names its type. <!-- id:NOOG5UHp -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:6u6fG474 -->
