---
name: "Example: Address"
summary: "A postal address: street and city (required) plus an optional postal code."
schemaDefinition: ipfs://bafyreigumuyohvqdkfbxcnoodmf2fynhrootgifgkyhck6cwolfzmoflru
---
This document describes the **example-address** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zGVF-gc0 -->

# Shape <!-- id:lFNyvCCx -->

A **closed struct** with these fields: <!-- id:XGrPnmSZ -->
  - `street` _(required)_ — [string](./onyx-string.md) <!-- id:HT49CZz8 -->
  - `city` _(required)_ — [string](./onyx-string.md) <!-- id:qzZ2rGQ3 -->
  - `postalCode` — [string](./onyx-string.md) <!-- id:PeOlj5sn -->

# Depends on <!-- id:Rd4ib7lU -->

- [string](./onyx-string.md) <!-- id:WE2Dzd5r -->
