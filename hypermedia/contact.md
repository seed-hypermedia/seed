---
name: Contact
summary: "A contact record: one account's named reference to another account (the subject), with subscription preferences."
schemaDefinition: ipfs://bafyreibmuvwe6vynr2oahkg7toc43uhlkokfsz3kqlkx2dez2wljvmdkry
---
This document describes the **contact** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:LPwoGs-L -->

# Shape <!-- id:ME2Gye2p -->

**Extends** [blob](./blob.md) with these added fields: <!-- id:WjOZXUDV -->
  - `type` — `"Contact"` <!-- id:NIqiWA2a -->
  - `id` — [string](./string.md) <!-- id:3n_-393R -->
  - `account` — [principal](./principal.md) <!-- id:zI4HdIy8 -->
  - `subject` — [principal](./principal.md) <!-- id:bkt0fx8L -->
  - `name` — [string](./string.md) <!-- id:SQCjgwlt -->
  - `subscribe` — [contact/subscribe](./contact/subscribe.md) <!-- id:EtgdYE7E -->

# Depends on <!-- id:5LiFHG4S -->

- [blob](./blob.md) <!-- id:WeX8VjDl -->
- [contact/subscribe](./contact/subscribe.md) <!-- id:id0JfSFv -->
- [principal](./principal.md) <!-- id:x0-Ea1K- -->
- [string](./string.md) <!-- id:BjAJTc65 -->
