---
name: Event
summary: "A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and "
schemaDefinition: ipfs://bafyreigepir2rn5rz5g2sms35dhezssdlms3xyzys3gma6frchxosgw6oi
---
A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and optionally an `ends` date for spans. <!-- id:1OgsTNBq -->

This document describes the **example/event-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NmhbwjcE -->

# Shape <!-- id:oTgPG0I0 -->

**Extends** [document](../document.md) with these added fields: <!-- id:APCz1dtU -->
  - `metadata` — [metadata](../metadata.md) <!-- id:3BlrAOEX -->
  - _adds to [metadata](../metadata.md):_ <!-- id:-flnW6oD -->
  - `date` _(required)_ — [date](../date.md) <!-- id:_Ag7fzQQ -->
  - `ends` — [date](../date.md) <!-- id:VjLj8NPb -->
  - `location` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:GSv_Ii93 -->
  - `protagonist` — [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:DQNXz62n -->
  - `faction` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:PPo0M0q_ -->
  - `outcome` — [string](../string.md) (one of `victory`, `defeat`, `stalemate`, `unknown`) <!-- id:29jEp_Bn -->

# Depends on <!-- id:6bYy92Ql -->

- [document](../document.md) <!-- id:IJAmT5zD -->
- [hm-url](../hm-url.md) <!-- id:rgdKlppM -->
- [metadata](../metadata.md) <!-- id:yDobZJoW -->
- [date](../date.md) <!-- id:-cgxdt72 -->
- [string](../string.md) <!-- id:HeRKKPgt -->
