---
name: Variant
summary: "One of the member schemas of the meta-schema union: the nine closed-map schema kinds plus the bare string, integer, boolean, and null literals."
---
**Variant**: one of the member schemas of the [meta-schema](../schema.md) union. Nine are closed maps: [`schema/struct-schema`](./struct-schema.md), [`schema/map-schema`](./map-schema.md), [`schema/list-schema`](./list-schema.md), [`schema/scalar-schema`](./scalar-schema.md), [`schema/link-schema`](./link-schema.md), [`schema/include-schema`](./include-schema.md), [`schema/anyof`](./anyof.md), [`schema/var-schema`](./var-schema.md) and [`schema/literal-schema`](./literal-schema.md). The other four are the bare `string`, `integer`, `boolean` and `null` kinds, which are literals. <!-- id:ndDb3Ur5 -->

# See also <!-- id:aPPMMnjb -->

- [Discriminated union](./discriminated-union.md): how a value picks its variant. <!-- id:uVQINlXK -->
- [Union schema](./anyof.md): the `anyOf` construct the meta-schema uses. <!-- id:04z1MQuG -->
- [Primitive](./primitive.md): an instance of the meta-schema, which is a different thing. <!-- id:LYRm9FQ2 -->
- [Closed map](./closed-map.md): why each variant rejects stray keys. <!-- id:ly-qAxF2 -->
