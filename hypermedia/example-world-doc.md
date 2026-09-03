---
name: World
summary: "A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events;"
schemaDefinition: ipfs://bafyreihtsf6cmsn37aqr5fwv53ue4k75pm7c74grknmemam5pwjd2mbumu
---
A world-builder kit type: the root page of a fictional world. Its children are the type definitions and the folders of characters, places, factions, and events; its metadata names the genre and the date the chronicle begins. <!-- id:tWJgX3A2 -->

This document describes the **example-world-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:afUtpf0w -->

# Shape <!-- id:f1KbJ2ci -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:qfyt9Gtj -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:0iNrXaS0 -->
  - _adds to [hypermedia-metadata](./hypermedia-metadata.md):_ <!-- id:r0KTtnBZ -->
  - `genre` _(required)_ — [string](./onyx-string.md) (one of `fantasy`, `science-fiction`, `historical`, `contemporary`, `mythic`) <!-- id:0ujhBQvU -->
  - `epoch` — [date](./onyx-date.md) <!-- id:U_Ww1oVZ -->
  - `tagline` — [string](./onyx-string.md) <!-- id:JSSPut80 -->

# Depends on <!-- id:isqmdDcM -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:HZ4iDpUw -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:w3N25OWp -->
- [date](./onyx-date.md) <!-- id:vd6ctMNl -->
- [string](./onyx-string.md) <!-- id:3hGaivVk -->
