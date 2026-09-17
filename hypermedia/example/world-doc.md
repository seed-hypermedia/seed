---
name: World
summary: "A world-builder page type for the root of a fictional world, whose children hold the type definitions and the folders of characters, places, factions, and events."
schemaDefinition: ipfs://bafyreihszwaw2sq3ujjsrjqqrwo2lasp3qml3y5gj5byo3iuyzuhnrkh4e
---
A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events; its attributes name the genre and the date the chronicle begins. <!-- id:tWJgX3A2 -->

This document describes the **example/world-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:afUtpf0w -->

# Shape <!-- id:f1KbJ2ci -->

A **closed struct** with these fields: <!-- id:qfyt9Gtj -->
  - `genre` _(required)_ — [string](../string.md) (one of `fantasy`, `science-fiction`, `historical`, `contemporary`, `mythic`) <!-- id:0ujhBQvU -->
  - `epoch` — [date](../date.md) <!-- id:U_Ww1oVZ -->
  - `tagline` — [string](../string.md) <!-- id:JSSPut80 -->

# Depends on <!-- id:isqmdDcM -->

- [date](../date.md) <!-- id:vd6ctMNl -->
- [string](../string.md) <!-- id:3hGaivVk -->
