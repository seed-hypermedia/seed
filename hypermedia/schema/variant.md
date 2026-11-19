---
name: Variant
summary: "A variant is one of the shapes a schema can take: nine are closed maps, and four let a bare string, integer, boolean or null be a schema."
---
A **variant** is one of the shapes a schema can take. The [meta-schema](../schema.md) is a [union](./anyof.md), and each variant is one member of that union. A valid schema matches one of them. <!-- id:ndDb3Ur5 -->

Nine variants are [closed maps](./closed-map.md):

- [`schema/struct-schema`](./struct-schema.md)
- [`schema/map-schema`](./map-schema.md)
- [`schema/list-schema`](./list-schema.md)
- [`schema/scalar-schema`](./scalar-schema.md)
- [`schema/link-schema`](./link-schema.md)
- [`schema/include-schema`](./include-schema.md)
- [`schema/anyof`](./anyof.md)
- [`schema/var-schema`](./var-schema.md)
- [`schema/literal-schema`](./literal-schema.md)

The other four let a plain value be a schema: a bare string, integer, boolean or null. Such a value is a [literal](./literal-schema.md) and accepts only itself.

# See also <!-- id:aPPMMnjb -->

- [Discriminated union](./discriminated-union.md): how a value picks its variant. <!-- id:uVQINlXK -->
- [Union schema](./anyof.md): the `anyOf` construct the meta-schema uses. <!-- id:04z1MQuG -->
- [Primitive](./primitive.md): one finished schema, which is a different thing. <!-- id:LYRm9FQ2 -->
- [Closed map](./closed-map.md): why each variant rejects stray keys. <!-- id:ly-qAxF2 -->
