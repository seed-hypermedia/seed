---
name: Contact
summary: "A contact record: one account's named reference to another account (the subject), with subscription preferences."
schemaDefinition: ipfs://bafyreihm7jel2oqwiwxogjn4ocwtfv27u3oddq3femu3a5xbdd4mqhrau4
---
This document describes the **hypermedia-contact** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LPwoGs-L -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [hypermedia-blob](./hypermedia-blob.md) with these added fields: <!-- id:WjOZXUDV -->
  - `type` — `string` enum: `Contact` <!-- id:NIqiWA2a -->
  - `id` — [string](./hypermedia-string.md) <!-- id:3n_-393R -->
  - `account` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:zI4HdIy8 -->
  - `subject` — [hypermedia-principal](./hypermedia-principal.md) <!-- id:bkt0fx8L -->
  - `name` — [string](./hypermedia-string.md) <!-- id:SQCjgwlt -->
  - `subscribe` — [hypermedia-contact-subscribe](./hypermedia-contact-subscribe.md) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [hypermedia-blob](./hypermedia-blob.md) <!-- id:WeX8VjDl -->
- [hypermedia-contact-subscribe](./hypermedia-contact-subscribe.md) <!-- id:id0JfSFv -->
- [hypermedia-principal](./hypermedia-principal.md) <!-- id:x0-Ea1K- -->
- [string](./hypermedia-string.md) <!-- id:BjAJTc65 -->
