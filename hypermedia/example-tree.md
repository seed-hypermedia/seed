---
name: "Example: Tree"
summary: A node holding an integer value and links to child nodes.
schemaDefinition: ipfs://bafyreib4zbbz3564urq35czgobddicpdzhkh2bx7sonb5aqi5mbyqgsgiy
---
This document describes the **example-tree** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:iIAXUuqT -->

# Shape <!-- id:qHaa2ZeF -->

A **closed struct** with these fields: <!-- id:yQtqZKJv -->
  - `value` _(required)_ — [integer](./onyx-integer.md) <!-- id:3BtaYYI8 -->
  - `children` — list of `link` → [example-tree](./example-tree.md) <!-- id:VRg-fWag -->

# Depends on <!-- id:j7V1B1aL -->

- [integer](./onyx-integer.md) <!-- id:G7JqZKJV -->
