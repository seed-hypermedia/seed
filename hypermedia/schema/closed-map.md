---
name: Closed Map
summary: A struct schema with `properties` and no `values`, so keys outside `properties` are rejected.
---
**Closed map**: a [struct schema](./struct-schema.md) with `properties` and no `values`. Keys outside `properties` are rejected. Structs are closed by default, and that is what lets the [meta-schema](../schema.md) reject malformed schemas. Add `values` to open the map. <!-- id:6hKvuX6y -->

# See also <!-- id:I6klWjYS -->

- [Struct schema](./struct-schema.md): `properties` and the optional `values`. <!-- id:_H78gYV0 -->
- [Map schema](./map-schema.md): arbitrary keys with one value type. <!-- id:S6EULooc -->
- [Property](./property.md): one named field. <!-- id:MbCWZawz -->
- [Variant](./variant.md): every variant is a closed map. <!-- id:BS4RZ_NU -->
