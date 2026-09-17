---
name: "Example: Tree"
summary: A node holding an integer value and links to child nodes.
schemaDefinition: ipfs://bafyreihszrccmx2r3wpb4whra6n7uajwlfjkjcni3rq5wifuarloevrnby
---
A tree node: an [integer](../integer.md) value and a list of [links](../link.md) to child trees. The type refers to itself, which works because schemas [reference each other by name](../schema/references.md). <!-- id:CCzItuKw -->

This page describes the **example/tree** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:iIAXUuqT -->

# Shape <!-- id:qHaa2ZeF -->

A **closed struct** with these fields: <!-- id:yQtqZKJv -->
  - `value` _(required)_: [integer](../integer.md) <!-- id:3BtaYYI8 -->
  - `children`: list of `link` → [example/tree](./tree.md) <!-- id:VRg-fWag -->

# Depends on <!-- id:j7V1B1aL -->

- [integer](../integer.md) <!-- id:G7JqZKJV -->

# See also <!-- id:UNo8e-V7 -->

- [comment](./comment.md): another self-referencing type. <!-- id:yDFn0zDi -->
- [json](./json.md): a recursive union. <!-- id:t4dFIkmp -->
- [References](../schema/references.md): why recursion works. <!-- id:aq7UYu4h -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:cXcvuqJC -->
