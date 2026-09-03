---
name: Faction
summary: "A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a"
schemaDefinition: ipfs://bafyreihjtji3ktrqo7bky2ts7a5fn6lsr6k4hww2x23ztnvnxq66syah3y
---
A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a banner image. <!-- id:RvItBHZN -->

This document describes the **example-faction-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Q-lkJuXw -->

# Shape <!-- id:5EsVMAhL -->

**Extends** [hypermedia-document](./hypermedia-document.md) with these added fields: <!-- id:-hXTuVju -->
  - `metadata` — [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:tGO7Z_Te -->
  - _adds to [hypermedia-metadata](./hypermedia-metadata.md):_ <!-- id:JFmr_1Iy -->
  - `founded` _(required)_ — [date](./onyx-date.md) <!-- id:IKQ8ylg_ -->
  - `dissolved` — [date](./onyx-date.md) <!-- id:goqd0e_j -->
  - `seat` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-place-doc](./example-place-doc.md)) <!-- id:ii5ONvHX -->
  - `leader` — [hypermedia-hm-url](./hypermedia-hm-url.md) (→ must conform to [example-character-doc](./example-character-doc.md)) <!-- id:4wLuR37p -->
  - `banner` — [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:z9Hj7vQe -->

# Depends on <!-- id:FhzqPOgw -->

- [hypermedia-document](./hypermedia-document.md) <!-- id:ykhnuylE -->
- [hypermedia-hm-url](./hypermedia-hm-url.md) <!-- id:-qmfs1ee -->
- [hypermedia-ipfs](./hypermedia-ipfs.md) <!-- id:niUF-Oyt -->
- [hypermedia-metadata](./hypermedia-metadata.md) <!-- id:AisaIh3L -->
- [date](./onyx-date.md) <!-- id:CiiSksy4 -->
