---
name: World
summary: "A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events;"
schemaDefinition: ipfs://bafyreih3zktvjm5tylsg4ldmqetnl43s3jyg6goaehfgshbqgwntuscxtm
---
A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events; its metadata names the genre and the date the chronicle begins. <!-- id:tWJgX3A2 -->

This document describes the **example/world-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:afUtpf0w -->

# Shape <!-- id:f1KbJ2ci -->

**Extends** [document](../document.md) with these added fields: <!-- id:qfyt9Gtj -->
  - `metadata` — [metadata](../metadata.md) <!-- id:0iNrXaS0 -->
  - _adds to [metadata](../metadata.md):_ <!-- id:r0KTtnBZ -->
  - `genre` _(required)_ — [string](../schema/string.md) (one of `fantasy`, `science-fiction`, `historical`, `contemporary`, `mythic`) <!-- id:0ujhBQvU -->
  - `epoch` — [date](../schema/date.md) <!-- id:U_Ww1oVZ -->
  - `tagline` — [string](../schema/string.md) <!-- id:JSSPut80 -->

# Depends on <!-- id:isqmdDcM -->

- [document](../document.md) <!-- id:HZ4iDpUw -->
- [metadata](../metadata.md) <!-- id:w3N25OWp -->
- [date](../schema/date.md) <!-- id:vd6ctMNl -->
- [string](../schema/string.md) <!-- id:3hGaivVk -->
