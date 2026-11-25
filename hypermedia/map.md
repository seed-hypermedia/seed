---
name: Map
summary: A map of string keys to values of one type (Map<Any> until `values` constrains it); use a struct when the field names are known.
---
The **map** type holds values under string keys, where the keys are data and not known in advance. An example is a map from each word to its count. On its own it accepts values of [any](./any.md) type. A [map schema](./schema/map-schema.md) adds `values`, and then each value must match the `values` schema. When the keys are known field names, use a [struct](./struct.md) instead. It is a [primitive](./schema/primitive.md) of the [data model](./schema/data-model.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:kVoJpXNY -->

# See also <!-- id:WaOHu56X -->

- [struct](./struct.md): a map with known, named fields. <!-- id:oLQX35vi -->
- [Map schema](./schema/map-schema.md): how a schema constrains the values. <!-- id:5Owa55ZV -->
- [Example: Counts](./example/counts.md): a map in use. <!-- id:T9m1ZsgI -->
- [Data model](./schema/data-model.md): all the kinds. <!-- id:--9KkCvb -->
- [Catalogue of types](./schema/types.md): every type in the library.
