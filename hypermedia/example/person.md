---
name: "Example: Person"
summary: A person with a name, age, active flag, home address, and nicknames.
schemaDefinition: ipfs://bafyreifwi3fgnkhklay3yxae5trvpz2n6yr3eyomurprjnl2ex4upj7k54
---
A person: a required `name`, an [integer](../integer.md) age, a [boolean](../boolean.md) active flag, a home that [includes](../schema/include-schema.md) [address](./address.md), and a [list](../list.md) of nicknames. [employee](./employee.md) extends it, and [alice](./alice.md) and [carol](./carol.md) are instances.

This page describes the **example/person** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:kz18rr1h -->

# Shape <!-- id:nO4ZbXuU -->

A **closed struct** with these fields: <!-- id:51ZzX9mF -->
  - `name` _(required)_: [string](../string.md) <!-- id:YKA6rXKs -->
  - `age`: [integer](../integer.md) <!-- id:6Bn2OXOQ -->
  - `active`: [boolean](../boolean.md) <!-- id:IP0tRSYe -->
  - `home`: [example/address](./address.md) <!-- id:unQF92CR -->
  - `nicknames`: list of [string](../string.md) <!-- id:frbGcNPJ -->

# Depends on <!-- id:m3wQHzN9 -->

- [example/address](./address.md) <!-- id:I8YpzqPS -->
- [boolean](../boolean.md) <!-- id:JFRlonA9 -->
- [integer](../integer.md) <!-- id:ahaLhNaq -->
- [string](../string.md) <!-- id:IXcpwC8q -->

# See also

- [address](./address.md): the included home type.
- [employee](./employee.md): extends person.
- [alice](./alice.md): an instance.
- [person-doc](./person-doc.md): a person as a document type.
- [Examples](../example.md): every example, grouped by feature.
