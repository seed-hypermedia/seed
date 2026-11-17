---
name: Closed Map
summary: A closed map is a struct schema with `properties` and no `values`, so it rejects every key that `properties` does not list.
---
A **closed map** accepts only the keys its schema lists. It is a [struct schema](./struct-schema.md) with `properties` and no `values`. A value with any other key is rejected. For example, a closed [struct](../struct.md) with the fields `name` and `age` rejects `{"name": "Bob", "color": "red"}`. <!-- id:6hKvuX6y -->

A struct is closed unless you open it. To open it, add `values`: then extra keys are allowed, and each extra value must match the `values` schema. Closed structs are what let the [meta-schema](../schema.md) reject a schema with a misspelled or unknown key.

# See also <!-- id:I6klWjYS -->

- [Struct schema](./struct-schema.md): `properties` and the optional `values`. <!-- id:_H78gYV0 -->
- [Map schema](./map-schema.md): any keys, with one value type. <!-- id:S6EULooc -->
- [Property](./property.md): one named field. <!-- id:MbCWZawz -->
- [Variant](./variant.md): every variant is a closed map. <!-- id:BS4RZ_NU -->
