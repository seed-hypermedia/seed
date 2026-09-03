---
name: Event
summary: "A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and "
schemaDefinition: ipfs://bafyreieilkmkust2h2n3tun3uttv43f7chfimbunwwggqcb3hkhisvxhna
---
A world-builder kit type: a page about something that happened. Requires a `date` and links the event to a location (a Place), a protagonist (a Character), and optionally an `ends` date for spans. <!-- id:1OgsTNBq -->

This document describes the **example-event-doc** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:NmhbwjcE -->

# Shape <!-- id:oTgPG0I0 -->
**Extends** [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) with these added fields: <!-- id:APCz1dtU -->
  - `metadata` — [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:3BlrAOEX -->
  - _adds to [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata):_ <!-- id:-flnW6oD -->
  - `date` _(required)_ — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:_Ag7fzQQ -->
  - `ends` — [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:VjLj8NPb -->
  - `location` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-place-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-place-doc)) <!-- id:GSv_Ii93 -->
  - `protagonist` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-character-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-character-doc)) <!-- id:DQNXz62n -->
  - `faction` — [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) (→ must conform to [example-faction-doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-faction-doc)) <!-- id:PPo0M0q_ -->
  - `outcome` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) (one of `victory`, `defeat`, `stalemate`, `unknown`) <!-- id:29jEp_Bn -->

# Depends on <!-- id:6bYy92Ql -->
- [hypermedia-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-document) <!-- id:IJAmT5zD -->
- [hypermedia-hm-url](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-hm-url) <!-- id:rgdKlppM -->
- [hypermedia-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-metadata) <!-- id:yDobZJoW -->
- [date](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/date) <!-- id:-cgxdt72 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HeRKKPgt -->