---
name: Contact
summary: "A contact record: one account's named reference to another account (the subject), with subscription preferences."
schemaDefinition: ipfs://bafyreied2w5ezkmeehquhmguslxymygz5pnovfv3o7troo23i44hsn53j4
---
This document describes the **hypermedia-contact** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LPwoGs-L -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:WjOZXUDV -->
  - `type` — `string` enum: `Contact` <!-- id:NIqiWA2a -->
  - `id` — [string](./onyx-string.md) <!-- id:3n_-393R -->
  - `account` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:zI4HdIy8 -->
  - `subject` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:bkt0fx8L -->
  - `name` — [string](./onyx-string.md) <!-- id:SQCjgwlt -->
  - `subscribe` — [hypermedia-contact-subscribe](./hypermedia-contact-subscribe.md) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:WeX8VjDl -->
- [hypermedia-contact-subscribe](./hypermedia-contact-subscribe.md) <!-- id:id0JfSFv -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:x0-Ea1K- -->
- [string](./onyx-string.md) <!-- id:BjAJTc65 -->
