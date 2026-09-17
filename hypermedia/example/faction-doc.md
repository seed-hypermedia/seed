---
name: Faction
summary: "A world-builder page type for a faction, order, house, or guild, whose attributes require a founding date and link to its seat, its leader, and a banner."
schemaDefinition: ipfs://bafyreianjjmb5gp24n2ylkgm5m2qqht54bjs6y7qzs3oujmyjmc5yffple
---
A world-builder kit type: a page about a faction, order, house, or guild. Its attributes require a `founded` date; they link to its seat (a Place) and leader (a Character), and a banner image. <!-- id:RvItBHZN -->

This document describes the **example/faction-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Q-lkJuXw -->

# Shape <!-- id:5EsVMAhL -->

A **closed struct** with these fields: <!-- id:-hXTuVju -->
  - `founded` _(required)_ — [date](../date.md) <!-- id:IKQ8ylg_ -->
  - `dissolved` — [date](../date.md) <!-- id:goqd0e_j -->
  - `seat` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ii5ONvHX -->
  - `leader` — [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:4wLuR37p -->
  - `banner` — [ipfs-url](../ipfs-url.md) <!-- id:z9Hj7vQe -->

# Depends on <!-- id:FhzqPOgw -->

- [hm-url](../hm-url.md) <!-- id:-qmfs1ee -->
- [ipfs-url](../ipfs-url.md) <!-- id:niUF-Oyt -->
- [date](../date.md) <!-- id:CiiSksy4 -->
