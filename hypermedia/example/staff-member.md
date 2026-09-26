---
name: "Example: Staff Member"
summary: An employee who is also a contact, the intersection of the two.
---
An [employee](./employee.md) **and** a [contact](./contact.md): `name`, `age`, `active`, `home` and `nicknames` from [person](./person.md), `employeeId` and `department` from employee, `email` and `phone` from contact. `name`, `employeeId` and `email` are required, and the struct stays closed. It is written with [`allOf`](../schema/allof.md), so it is a subtype of both arms: a typed link to employee, or to contact, accepts a staff member.

This page describes the **example/staff-member** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type.

# See also

- [employee](./employee.md) and [contact](./contact.md): the two arms.
- [admin](./admin.md): the other way to build on employee, by extension with one parent.
- [Intersection schema](../schema/allof.md): how `allOf` merges its arms.
- [Examples](../example.md): every example, grouped by feature.
