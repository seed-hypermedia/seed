---
name: "Example: Address"
summary: "A postal address: street and city (required) plus an optional postal code."
schemaDefinition: ipfs://bafyreigpnswlke7we5sadhdmcb5m5lqsopvh5spgqkvtbkzfq4l5br6qea
---
This document describes the **example/address** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:zGVF-gc0 -->

# Shape <!-- id:lFNyvCCx -->

A **closed struct** with these fields: <!-- id:XGrPnmSZ -->
  - `street` _(required)_ — [string](../string.md) <!-- id:HT49CZz8 -->
  - `city` _(required)_ — [string](../string.md) <!-- id:qzZ2rGQ3 -->
  - `postalCode` — [string](../string.md) <!-- id:PeOlj5sn -->

# Depends on <!-- id:Rd4ib7lU -->

- [string](../string.md) <!-- id:WE2Dzd5r -->
