---
name: Event
summary: "A world-builder page type for something that happened, whose attributes require a date and link the event to a place and a protagonist character."
schemaDefinition: ipfs://bafyreifl3hbrvjn4xtsnzkxatspsqq2hyarrfsp4hjxe34je7f5fclvtxy
---
A [World Builder](../schema/world-builder.md) page type for something that happened. Its [attributes](../schema/typed-documents.md) require a `date`. They link the event to a location, which is a [place](./place-doc.md), and a protagonist, which is a [character](./character-doc.md). An optional `ends` date covers spans. <!-- id:1OgsTNBq -->

This page describes the **example/event-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:NmhbwjcE -->

# Shape <!-- id:oTgPG0I0 -->

A **closed struct** with these fields: <!-- id:APCz1dtU -->
  - `date` _(required)_: [date](../date.md) <!-- id:_Ag7fzQQ -->
  - `ends`: [date](../date.md) <!-- id:VjLj8NPb -->
  - `location`: [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:GSv_Ii93 -->
  - `protagonist`: [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:DQNXz62n -->
  - `faction`: [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:PPo0M0q_ -->
  - `outcome`: [string](../string.md) (one of `victory`, `defeat`, `stalemate`, `unknown`) <!-- id:29jEp_Bn -->

# Depends on <!-- id:6bYy92Ql -->

- [hm-url](../hm-url.md) <!-- id:rgdKlppM -->
- [date](../date.md) <!-- id:-cgxdt72 -->
- [string](../string.md) <!-- id:HeRKKPgt -->

# See also

- [World Builder](../schema/world-builder.md): the demo these types come from.
- [character-doc](./character-doc.md): the protagonist type.
- [faction-doc](./faction-doc.md): the faction type.
- [Typed documents](../schema/typed-documents.md): how a page names its type.
- [Examples](../example.md): every example, grouped by feature.
