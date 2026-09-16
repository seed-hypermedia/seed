---
name: "Example: Person"
summary: A person with a name, age, active flag, home address, and nicknames.
schemaDefinition: ipfs://bafyreifwi3fgnkhklay3yxae5trvpz2n6yr3eyomurprjnl2ex4upj7k54
---
This document describes the **example/person** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kz18rr1h -->

# Shape <!-- id:nO4ZbXuU -->

A **closed struct** with these fields: <!-- id:51ZzX9mF -->
  - `name` _(required)_ — [string](../string.md) <!-- id:YKA6rXKs -->
  - `age` — [integer](../integer.md) <!-- id:6Bn2OXOQ -->
  - `active` — [boolean](../boolean.md) <!-- id:IP0tRSYe -->
  - `home` — [example/address](./address.md) <!-- id:unQF92CR -->
  - `nicknames` — list of [string](../string.md) <!-- id:frbGcNPJ -->

# Depends on <!-- id:m3wQHzN9 -->

- [example/address](./address.md) <!-- id:I8YpzqPS -->
- [boolean](../boolean.md) <!-- id:JFRlonA9 -->
- [integer](../integer.md) <!-- id:ahaLhNaq -->
- [string](../string.md) <!-- id:IXcpwC8q -->
