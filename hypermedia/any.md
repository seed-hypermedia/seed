---
name: Any
summary: "The top type that matches any Hypermedia value: null, boolean, number, string, bytes, link, or a list or map of any."
---
The **any** type matches every Hypermedia value: null, a boolean, an integer, a float, a string, bytes, a [link](./link.md), or a list or map of any. Use it where a field can hold anything. <!-- id:oO6eJaVw -->

It is a [union](./schema/anyof.md) of the nine [kinds](./schema/kind.md) of the [data model](./schema/data-model.md), with lists and maps of any inside. It is not a [primitive](./schema/primitive.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type.

# See also <!-- id:nQDtHodx -->

- [none](./none.md): the bottom type, which accepts no values. <!-- id:zQN0qoQN -->
- [Data model](./schema/data-model.md): the kinds every value is built from. <!-- id:LPER4UwP -->
- [value](./value.md): the smaller union a metadata attribute can hold. <!-- id:49AnlS5k -->
- [list](./list.md) and [map](./map.md): the container kinds. <!-- id:LdxJNcAp -->
- [block](./block.md): the open type of a [block](./protocol/blocks.md), whose extra fields are of this type. <!-- id:FqUALYAw -->
- [Catalogue of types](./schema/types.md): every type in the library.
