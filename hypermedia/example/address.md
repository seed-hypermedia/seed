---
name: "Example: Address"
summary: "A postal address: street and city (required) plus an optional postal code."
schemaDefinition: ipfs://bafyreigpnswlke7we5sadhdmcb5m5lqsopvh5spgqkvtbkzfq4l5br6qea
---
A postal address. It is a [struct](../struct.md) of three [strings](../string.md): `street` and `city` are required, and `postalCode` is optional. [person](./person.md) includes it as `home`. <!-- id:kGs7gPpl -->

This page describes the **example/address** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:zGVF-gc0 -->

# Shape <!-- id:lFNyvCCx -->

A **closed struct** with these fields: <!-- id:XGrPnmSZ -->
  - `street` _(required)_: [string](../string.md) <!-- id:HT49CZz8 -->
  - `city` _(required)_: [string](../string.md) <!-- id:qzZ2rGQ3 -->
  - `postalCode`: [string](../string.md) <!-- id:PeOlj5sn -->

# Depends on <!-- id:Rd4ib7lU -->

- [string](../string.md) <!-- id:WE2Dzd5r -->

# See also <!-- id:e7-J7YXX -->

- [person](./person.md): includes an address. <!-- id:Ier1i-ao -->
- [geo](./geo.md): another small struct. <!-- id:erjFEI6H -->
- [Struct](../struct.md): named fields, required or optional. <!-- id:PJcxselK -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:BO-6B40r -->
