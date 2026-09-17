---
name: Any
summary: "The top type that matches any Hypermedia value: null, boolean, number, string, bytes, link, or a list or map of any."
schemaDefinition: ipfs://bafyreibpjj4gpwndtgzy4wxrv4jpbh3yngqoocmmdpb63deg4rbegzltea
---
The **any** type matches every Hypermedia value: null, a boolean, a number, a string, bytes, a [link](./link.md), or a list or map of any. It is a [primitive](./schema/primitive.md) of the [data model](./schema/data-model.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:oO6eJaVw -->

# Shape <!-- id:B6ckZa1m -->

A **union**. A value matches one of these variants: <!-- id:6EezA2oG -->
  - [null](./null.md) <!-- id:cWQtIR13 -->
  - [boolean](./boolean.md) <!-- id:8wkCTWj0 -->
  - [integer](./integer.md) <!-- id:yhTYx7Wv -->
  - [float](./float.md) <!-- id:q_ivdjoq -->
  - [string](./string.md) <!-- id:iXK9KfV0 -->
  - [bytes](./bytes.md) <!-- id:oowqeiVG -->
  - [link](./link.md) <!-- id:5jlyKmWE -->
  - list of [any](./any.md) <!-- id:HOSZE8Y1 -->
  - map ⟨ \* : [any](./any.md) ⟩ <!-- id:zhX2rUxo -->

# Depends on <!-- id:J36yzGwM -->

- [boolean](./boolean.md) <!-- id:GtOFz5XG -->
- [bytes](./bytes.md) <!-- id:KPaOP9M- -->
- [float](./float.md) <!-- id:ORak9602 -->
- [integer](./integer.md) <!-- id:8pn0Cxu_ -->
- [link](./link.md) <!-- id:w35p-zQq -->
- [null](./null.md) <!-- id:3eQVhAK1 -->
- [string](./string.md) <!-- id:Wgktcf4G -->

# See also <!-- id:nQDtHodx -->

- [Data model](./schema/data-model.md): the kinds every value is built from. <!-- id:LPER4UwP -->
- [value](./value.md): the smaller union a metadata attribute can hold. <!-- id:49AnlS5k -->
- [list](./list.md) and [map](./map.md): the container kinds. <!-- id:LdxJNcAp -->
- [block](./block.md): the open block, whose extra fields are of this type. <!-- id:FqUALYAw -->
