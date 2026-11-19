---
name: Integer
summary: A whole number, which DAG-CBOR encodes distinctly from floats.
---
The **integer** type is a whole number, such as `42` or `-7`. [DAG-CBOR](./schema/dag-cbor.md) encodes an integer in a different way from a [float](./float.md), so `1` and `1.0` are different values. It is a [primitive](./schema/primitive.md) of the [data model](./schema/data-model.md): the ready-made schema for one [kind](./schema/kind.md) of value. The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:_O8DSgHF -->

# See also <!-- id:fa6R8Ypg -->

- [float](./float.md): floating-point numbers. <!-- id:X2QgMGNj -->
- [timestamp](./timestamp.md): Unix milliseconds, stored as an integer. <!-- id:RSUsKhlI -->
- [value](./value.md): the scalar values an attribute can hold. <!-- id:fcVXKZES -->
- [Data model](./schema/data-model.md): all the kinds. <!-- id:kkDgXSRa -->
- [Catalogue of types](./schema/types.md): every type in the library.
