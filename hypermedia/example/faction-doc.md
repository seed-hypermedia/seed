---
name: Faction
summary: "A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a"
schemaDefinition: ipfs://bafyreieniiozcpe2mhrt3xw6664snoqzutniuungbsq5xmtywslmdsiwqq
---
A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a banner image. <!-- id:RvItBHZN -->

This document describes the **example/faction-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Q-lkJuXw -->

# Shape <!-- id:5EsVMAhL -->

**Extends** [document](../document.md) with these added fields: <!-- id:-hXTuVju -->
  - `metadata` — [metadata](../metadata.md) <!-- id:tGO7Z_Te -->
  - _adds to [metadata](../metadata.md):_ <!-- id:JFmr_1Iy -->
  - `founded` _(required)_ — [date](../schema/date.md) <!-- id:IKQ8ylg_ -->
  - `dissolved` — [date](../schema/date.md) <!-- id:goqd0e_j -->
  - `seat` — [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ii5ONvHX -->
  - `leader` — [hm-url](../hm-url.md) (→ must conform to [example/character-doc](./character-doc.md)) <!-- id:4wLuR37p -->
  - `banner` — [ipfs-url](../ipfs-url.md) <!-- id:z9Hj7vQe -->

# Depends on <!-- id:FhzqPOgw -->

- [document](../document.md) <!-- id:ykhnuylE -->
- [hm-url](../hm-url.md) <!-- id:-qmfs1ee -->
- [ipfs-url](../ipfs-url.md) <!-- id:niUF-Oyt -->
- [metadata](../metadata.md) <!-- id:AisaIh3L -->
- [date](../schema/date.md) <!-- id:CiiSksy4 -->
