---
name: "Example: Employee"
summary: A person, extended with an employee id and department.
schemaDefinition: ipfs://bafyreielcu7oewncemr72j7ie4l7belc7lr3py6mke4td2d7wyornzulda
---
This document describes the **example/employee** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:xqJ2JASC -->

# Shape <!-- id:FRM7SadU -->

**Extends** [example/person](./person.md) with these added fields: <!-- id:XUqvPhRC -->
  - `employeeId` _(required)_ — [string](../schema/string.md) <!-- id:VBcJW2v6 -->
  - `department` — [string](../schema/string.md) <!-- id:LKh9yy5V -->

# Depends on <!-- id:Ah7bnx2c -->

- [example/person](./person.md) <!-- id:oci5ofGp -->
- [string](../schema/string.md) <!-- id:qBjztCB9 -->
