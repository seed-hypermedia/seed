---
name: "Example: Employee"
summary: A person, extended with an employee id and department.
schemaDefinition: ipfs://bafyreietsimil5brwt54ynqqk6uzjxiojkrbl5ubtd5o3lqmqv4p7siftu
---
A [person](./person.md) with a required `employeeId` and a `department`. It [extends](../schema/extension.md) person, and [admin](./admin.md) extends it in turn. [bob](./bob.md) and [dave](./dave.md) are instances.

This page describes the **example/employee** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:xqJ2JASC -->

# Shape <!-- id:FRM7SadU -->

**Extends** [example/person](./person.md) with these added fields: <!-- id:XUqvPhRC -->
  - `employeeId` _(required)_: [string](../string.md) <!-- id:VBcJW2v6 -->
  - `department`: [string](../string.md) <!-- id:LKh9yy5V -->

# Depends on <!-- id:Ah7bnx2c -->

- [example/person](./person.md) <!-- id:oci5ofGp -->
- [string](../string.md) <!-- id:qBjztCB9 -->

# See also

- [person](./person.md): the type it extends.
- [admin](./admin.md): the type that extends it.
- [bob](./bob.md): an instance.
- [Extension](../schema/extension.md): how a schema extends another.
- [Examples](../example.md): every example, grouped by feature.
