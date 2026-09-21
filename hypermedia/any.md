---
name: Any
summary: "The top type that matches any Hypermedia value: null, boolean, number, string, bytes, link, or a list or map of any."
---
The **any** type matches every Hypermedia value: null, a boolean, a number, a string, bytes, a [link](./link.md), or a list or map of any. It is a [primitive](./schema/primitive.md) of the [data model](./schema/data-model.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# See also <!-- id:nQDtHodx -->

- [none](./none.md): the bottom type, which accepts no values. <!-- id:zQN0qoQN -->
- [Data model](./schema/data-model.md): the kinds every value is built from. <!-- id:LPER4UwP -->
- [value](./value.md): the smaller union a metadata attribute can hold. <!-- id:49AnlS5k -->
- [list](./list.md) and [map](./map.md): the container kinds. <!-- id:LdxJNcAp -->
- [block](./block.md): the open block, whose extra fields are of this type. <!-- id:FqUALYAw -->
