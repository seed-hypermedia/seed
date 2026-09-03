---
name: Faction
summary: "A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a"
schemaDefinition: ipfs://bafyreihjtji3ktrqo7bky2ts7a5fn6lsr6k4hww2x23ztnvnxq66syah3y
---
A world-builder kit type: a page about a faction, order, house, or guild. Requires a `founded` date; links to its seat (a Place) and leader (a Character), and a banner image. <!-- id:RvItBHZN -->

This document describes the **example-faction-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:Q-lkJuXw -->

# Shape <!-- id:5EsVMAhL -->

**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:-hXTuVju -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:tGO7Z_Te -->
  - _adds to [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata):_ <!-- id:JFmr_1Iy -->
  - `founded` _(required)_ — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:IKQ8ylg_ -->
  - `dissolved` — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:goqd0e_j -->
  - `seat` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-place-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc)) <!-- id:ii5ONvHX -->
  - `leader` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-character-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-character-doc)) <!-- id:4wLuR37p -->
  - `banner` — [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:z9Hj7vQe -->

# Depends on <!-- id:FhzqPOgw -->

- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:ykhnuylE -->
- [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) <!-- id:-qmfs1ee -->
- [hypermedia-ipfs](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-ipfs) <!-- id:niUF-Oyt -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:AisaIh3L -->
- [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:CiiSksy4 -->
