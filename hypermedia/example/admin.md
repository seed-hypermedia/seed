---
name: "Example: Admin"
summary: An employee, extended with a map of boolean permission flags.
schemaDefinition: ipfs://bafyreifoyt2pno4ahpry3bflbt4qqnpmvjtwrj3ohp7rvkqg3wcyhytzui
---
An employee with a map of [boolean](../boolean.md) permission flags. It [extends](../schema/extension.md) [employee](./employee.md), which extends [person](./person.md), so the chain is two levels deep. [root](./root.md) is an instance. <!-- id:upE8ynaP -->

This page describes the **example/admin** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:5TfHks-3 -->

# Shape <!-- id:7bCLqs7s -->

**Extends** [example/employee](./employee.md) with these added fields: <!-- id:tNotYurF -->
  - `permissions` _(required)_: [map](../map.md) of [boolean](../boolean.md) <!-- id:lrACY6mq -->

# Depends on <!-- id:rrJYZRvC -->

- [example/employee](./employee.md) <!-- id:NuTdLmU4 -->
- [map](../map.md) <!-- id:HihJcAsQ -->
- [boolean](../boolean.md) <!-- id:KCYVQwzL -->

# See also <!-- id:fAa9iSAx -->

- [employee](./employee.md): the type it extends. <!-- id:t_B0axQ8 -->
- [root](./root.md): an instance. <!-- id:V22kXGp_ -->
- [Extension](../schema/extension.md): how a schema extends another. <!-- id:X4ayU-X8 -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:thCRQED1 -->
