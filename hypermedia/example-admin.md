---
name: "Example: Admin"
summary: An employee, extended with a list of permissions.
schemaDefinition: ipfs://bafyreiflahh55m7r2ozkoo2hi42pbxykyjgfdhdu4rdlqthumswwokxw3e
---
This document describes the **example-admin** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5TfHks-3 -->

# Shape <!-- id:7bCLqs7s -->

**Extends** [example-employee](./example-employee.md) with these added fields: <!-- id:tNotYurF -->
  - `permissions` _(required)_ — list of [string](./onyx-string.md) <!-- id:lrACY6mq -->

# Depends on <!-- id:rrJYZRvC -->

- [example-employee](./example-employee.md) <!-- id:NuTdLmU4 -->
- [string](./onyx-string.md) <!-- id:HihJcAsQ -->
