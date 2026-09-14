---
name: "Example: Admin"
summary: An employee, extended with a list of permissions.
schemaDefinition: ipfs://bafyreih2hp6afniijboyiaxbmhprloxahc6mi4szwxd5kcu23lkynb4swy
---
This document describes the **example/admin** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5TfHks-3 -->

# Shape <!-- id:7bCLqs7s -->

**Extends** [example/employee](./employee.md) with these added fields: <!-- id:tNotYurF -->
  - `permissions` _(required)_ — list of [string](../schema/string.md) <!-- id:lrACY6mq -->

# Depends on <!-- id:rrJYZRvC -->

- [example/employee](./employee.md) <!-- id:NuTdLmU4 -->
- [string](../schema/string.md) <!-- id:HihJcAsQ -->
