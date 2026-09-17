---
name: Event
summary: "A world-builder page type for something that happened, whose attributes require a date and link the event to a place and a protagonist character."
schemaDefinition: ipfs://bafyreifl3hbrvjn4xtsnzkxatspsqq2hyarrfsp4hjxe34je7f5fclvtxy
---
A world-builder kit type: a page about something that happened. Its attributes require a `date` and link the event to a location (a Place), a protagonist (a Character), and optionally an `ends` date for spans. <!-- id:1OgsTNBq -->

This document describes the **example/event-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NmhbwjcE -->

# Shape <!-- id:oTgPG0I0 -->

A **closed struct** with these fields: <!-- id:APCz1dtU -->
  - `date` _(required)_ — [date](../date.md) <!-- id:_Ag7fzQQ -->
  - `ends` — [date](../date.md) <!-- id:VjLj8NPb -->
  - `location` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:GSv_Ii93 -->
  - `protagonist` — [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:DQNXz62n -->
  - `faction` — [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:PPo0M0q_ -->
  - `outcome` — [string](../string.md) (one of `victory`, `defeat`, `stalemate`, `unknown`) <!-- id:29jEp_Bn -->

# Depends on <!-- id:6bYy92Ql -->

- [hm-url](../hm-url.md) <!-- id:rgdKlppM -->
- [date](../date.md) <!-- id:-cgxdt72 -->
- [string](../string.md) <!-- id:HeRKKPgt -->
