---
name: "Example: Employee"
summary: A person, extended with an employee id and department.
schemaDefinition: ipfs://bafyreietsimil5brwt54ynqqk6uzjxiojkrbl5ubtd5o3lqmqv4p7siftu
---
This document describes the **example/employee** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:xqJ2JASC -->

# Shape <!-- id:FRM7SadU -->

**Extends** [example/person](./person.md) with these added fields: <!-- id:XUqvPhRC -->
  - `employeeId` _(required)_: [string](../string.md) <!-- id:VBcJW2v6 -->
  - `department`: [string](../string.md) <!-- id:LKh9yy5V -->

# Depends on <!-- id:Ah7bnx2c -->

- [example/person](./person.md) <!-- id:oci5ofGp -->
- [string](../string.md) <!-- id:qBjztCB9 -->
