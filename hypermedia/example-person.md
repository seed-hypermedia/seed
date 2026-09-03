---
name: "Example: Person"
summary: A person with a name, age, active flag, home address, and nicknames.
schemaDefinition: ipfs://bafyreiecjmj5fpn6rshbkukj3mij4rr2mysalr3k3ev2dyketnufh4pqzq
---
This document describes the **example-person** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kz18rr1h -->

# Shape <!-- id:nO4ZbXuU -->

A **closed struct** with these fields: <!-- id:51ZzX9mF -->
  - `name` _(required)_ — [string](./onyx-string.md) <!-- id:YKA6rXKs -->
  - `age` — [integer](./onyx-integer.md) <!-- id:6Bn2OXOQ -->
  - `active` — [boolean](./onyx-boolean.md) <!-- id:IP0tRSYe -->
  - `home` — [example-address](./example-address.md) <!-- id:unQF92CR -->
  - `nicknames` — list of [string](./onyx-string.md) <!-- id:frbGcNPJ -->

# Depends on <!-- id:m3wQHzN9 -->

- [example-address](./example-address.md) <!-- id:I8YpzqPS -->
- [boolean](./onyx-boolean.md) <!-- id:JFRlonA9 -->
- [integer](./onyx-integer.md) <!-- id:ahaLhNaq -->
- [string](./onyx-string.md) <!-- id:IXcpwC8q -->
