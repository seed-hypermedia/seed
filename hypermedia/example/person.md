---
name: "Example: Person"
summary: A person with a name, age, active flag, home address, and nicknames.
schemaDefinition: ipfs://bafyreiagajziuqox67vwtyftbuvdi4h2r3wbvpexcohl2uktobftn4sxxa
---
This document describes the **example/person** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kz18rr1h -->

# Shape <!-- id:nO4ZbXuU -->

A **closed struct** with these fields: <!-- id:51ZzX9mF -->
  - `name` _(required)_ — [string](../schema/string.md) <!-- id:YKA6rXKs -->
  - `age` — [integer](../schema/integer.md) <!-- id:6Bn2OXOQ -->
  - `active` — [boolean](../schema/boolean.md) <!-- id:IP0tRSYe -->
  - `home` — [example/address](./address.md) <!-- id:unQF92CR -->
  - `nicknames` — list of [string](../schema/string.md) <!-- id:frbGcNPJ -->

# Depends on <!-- id:m3wQHzN9 -->

- [example/address](./address.md) <!-- id:I8YpzqPS -->
- [boolean](../schema/boolean.md) <!-- id:JFRlonA9 -->
- [integer](../schema/integer.md) <!-- id:ahaLhNaq -->
- [string](../schema/string.md) <!-- id:IXcpwC8q -->
