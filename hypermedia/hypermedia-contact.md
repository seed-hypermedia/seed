---
name: Contact
summary: "A contact record: one account's named reference to another account (the subject), with subscription preferences."
schemaDefinition: ipfs://bafyreied2w5ezkmeehquhmguslxymygz5pnovfv3o7troo23i44hsn53j4
---
This document describes the **hypermedia-contact** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LPwoGs-L -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:WjOZXUDV -->
  - `type` — `string` enum: `Contact` <!-- id:NIqiWA2a -->
  - `id` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:3n_-393R -->
  - `account` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:zI4HdIy8 -->
  - `subject` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:bkt0fx8L -->
  - `name` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:SQCjgwlt -->
  - `subscribe` — [hypermedia-contact-subscribe](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact-subscribe) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:WeX8VjDl -->
- [hypermedia-contact-subscribe](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-contact-subscribe) <!-- id:id0JfSFv -->
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:x0-Ea1K- -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:BjAJTc65 -->
