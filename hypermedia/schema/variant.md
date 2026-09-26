---
name: Variant
summary: "One of the member schemas of the meta-schema union: the ten closed-map schema kinds plus the bare string, integer, boolean, and null literals."
---
**Variant**: one of the member schemas of the [meta-schema](../schema.md) union. Ten are closed maps: `schema/struct-schema`, `schema/map-schema`, `schema/list-schema`, `schema/scalar-schema`, `schema/link-schema`, `schema/include-schema`, `schema/anyof`, `schema/allof`, `schema/var-schema` and `schema/literal-schema`. The other four are the bare `string`, `integer`, `boolean` and `null` kinds, which are literals. <!-- id:ndDb3Ur5 -->

# See also <!-- id:aPPMMnjb -->

- [Discriminated union](./discriminated-union.md): how a value picks its variant. <!-- id:uVQINlXK -->
- [Union schema](./anyof.md): the `anyOf` construct the meta-schema uses.
- [Intersection schema](./allof.md): the `allOf` variant. <!-- id:04z1MQuG -->
- [Primitive](./primitive.md): an instance of the meta-schema, which is a different thing. <!-- id:LYRm9FQ2 -->
- [Closed map](./closed-map.md): why each variant rejects stray keys. <!-- id:ly-qAxF2 -->
