---
name: Event
summary: "A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and "
schemaDefinition: ipfs://bafyreif5herkt3h7mywrdz7v5umll2olw2cb6snethvvw7pjte7h6rggsq
---
A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and optionally an `ends` date for spans. <!-- id:1OgsTNBq -->

This document describes the **example-event-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NmhbwjcE -->

# Shape <!-- id:oTgPG0I0 -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:APCz1dtU -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:3BlrAOEX -->
  - _adds to [hypermedia-metadata](./hypermedia-metadata.md):_ <!-- id:-flnW6oD -->
  - `date` _(required)_ — [date](./onyx-date.md) <!-- id:_Ag7fzQQ -->
  - `ends` — [date](./onyx-date.md) <!-- id:VjLj8NPb -->
  - `location` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-place-doc](./example-place-doc.md)) <!-- id:GSv_Ii93 -->
  - `protagonist` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-character-doc](./example-character-doc.md)) <!-- id:DQNXz62n -->
  - `faction` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-faction-doc](./example-faction-doc.md)) <!-- id:PPo0M0q_ -->
  - `outcome` — [string](./onyx-string.md) (one of `victory`, `defeat`, `stalemate`, `unknown`) <!-- id:29jEp_Bn -->

# Depends on <!-- id:6bYy92Ql -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:IJAmT5zD -->
- [hypermedia-hm-url](./hypermedia-hm-url.md) <!-- id:rgdKlppM -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:yDobZJoW -->
- [date](./onyx-date.md) <!-- id:-cgxdt72 -->
- [string](./onyx-string.md) <!-- id:HeRKKPgt -->
