---
name: Faction
summary: A world-builder page type for a faction, order, house, or guild, whose attributes require a founding date and link to its seat, its leader, and a banner.
schemaDefinition: ipfs://bafyreianjjmb5gp24n2ylkgm5m2qqht54bjs6y7qzs3oujmyjmc5yffple
---
A [World Builder](../schema/world-builder.md) page type for a faction, order, house or guild. Its [attributes](../schema/typed-documents.md) require a `founded` date. They link to its seat, which is a [place](./place-doc.md), its leader, which is a [character](./character-doc.md), and a banner image. <!-- id:RvItBHZN -->

This page describes the **example/faction-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:Q-lkJuXw -->

# Shape <!-- id:5EsVMAhL -->

A **closed struct** with these fields: <!-- id:-hXTuVju -->
  - `founded` _(required)_: [date](../date.md) <!-- id:IKQ8ylg_ -->
  - `dissolved`: [date](../date.md) <!-- id:goqd0e_j -->
  - `seat`: [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ii5ONvHX -->
  - `leader`: [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:4wLuR37p -->
  - `banner`: [ipfs-url](../ipfs-url.md) <!-- id:z9Hj7vQe -->

# Depends on <!-- id:FhzqPOgw -->

- [hm-url](../hm-url.md) <!-- id:-qmfs1ee -->
- [ipfs-url](../ipfs-url.md) <!-- id:niUF-Oyt -->
- [date](../date.md) <!-- id:CiiSksy4 -->

# See also <!-- id:kyDu5wCM -->

- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:1yK0ahw2 -->
- [place-doc](./place-doc.md): the seat type. <!-- id:vvoIbp7s -->
- [event-doc](./event-doc.md): events that involve factions. <!-- id:VvmrPdfG -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:Mwh4TkN- -->
