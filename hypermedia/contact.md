---
name: Contact
summary: "A contact record: one account's named reference to another account (the subject), with subscription preferences."
schemaDefinition: ipfs://bafyreibqdfkipjuekupzlsg5slpxlp5zde4z3m5c3ej3bclukm4zh325nq
---
This document describes the **contact** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LPwoGs-L -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:WjOZXUDV -->
  - `type` — `"Contact"` <!-- id:NIqiWA2a -->
  - `id` — [string](./schema/string.md) <!-- id:3n_-393R -->
  - `account` — [principal](./principal.md) <!-- id:zI4HdIy8 -->
  - `subject` — [principal](./principal.md) <!-- id:bkt0fx8L -->
  - `name` — [string](./schema/string.md) <!-- id:SQCjgwlt -->
  - `subscribe` — [schema/contact-subscribe](./schema/contact-subscribe.md) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [blob](./blob.md) <!-- id:WeX8VjDl -->
- [schema/contact-subscribe](./schema/contact-subscribe.md) <!-- id:id0JfSFv -->
- [principal](./principal.md) <!-- id:x0-Ea1K- -->
- [string](./schema/string.md) <!-- id:BjAJTc65 -->
