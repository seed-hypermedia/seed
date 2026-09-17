---
name: "Example: Address"
summary: "A postal address: street and city (required) plus an optional postal code."
schemaDefinition: ipfs://bafyreigpnswlke7we5sadhdmcb5m5lqsopvh5spgqkvtbkzfq4l5br6qea
---
A postal address. It is a [struct](../struct.md) of three [strings](../string.md): `street` and `city` are required, and `postalCode` is optional. [person](./person.md) includes it as `home`.

This page describes the **example/address** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:zGVF-gc0 -->

# Shape <!-- id:lFNyvCCx -->

A **closed struct** with these fields: <!-- id:XGrPnmSZ -->
  - `street` _(required)_: [string](../string.md) <!-- id:HT49CZz8 -->
  - `city` _(required)_: [string](../string.md) <!-- id:qzZ2rGQ3 -->
  - `postalCode`: [string](../string.md) <!-- id:PeOlj5sn -->

# Depends on <!-- id:Rd4ib7lU -->

- [string](../string.md) <!-- id:WE2Dzd5r -->

# See also

- [person](./person.md): includes an address.
- [geo](./geo.md): another small struct.
- [Struct](../struct.md): named fields, required or optional.
- [Examples](../example.md): every example, grouped by feature.
