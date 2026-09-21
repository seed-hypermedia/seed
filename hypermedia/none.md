---
name: None
summary: The bottom type, which accepts no values and is defined as an empty union.
---
The **none** type accepts no values. Its schema is `{"anyOf": []}`: there are no alternatives a value can match. Reference it as `{"type": "hm://hyper.media/none"}`. It is a schema built from the existing union vocabulary, not a new data kind. <!-- id:i1IGjzE- -->

Unlike none, the [null](./null.md) type and the bare literal schema `null` accept exactly one value: `null`. The [any](./any.md) type accepts every Hypermedia value. <!-- id:7GQol9Iu -->

A list whose `items` schema is none can only be empty. A map whose `values` schema is none can only be empty. On a struct, `values` applies to additional fields, so setting it to none forbids fields outside `properties`. An optional field typed none must be absent; a required field typed none makes the struct impossible to satisfy. <!-- id:KyHcjRq9 -->

The TypeScript generator emits `HMNone = never`. The type has no default value for editors to create. Its formal schema is attached as the `schemaDefinition` in this document's metadata. <!-- id:W0TpDrCU -->

# See also <!-- id:2ecP_G1Y -->

- [Union schema](./schema/anyof.md): a value must match at least one alternative. <!-- id:qeRTFpYc -->
- [Null](./null.md): the type with exactly one value. <!-- id:kdTi0uv8 -->
- [Any](./any.md): the type that accepts every value. <!-- id:g7czSn-4 -->
