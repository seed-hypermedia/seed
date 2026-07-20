---
name: "Employee"
summary: "A person, extended with an employee id and department."
---

# Employee

A person, extended with an employee id and department.


This document describes the **example-employee** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

**Extends** [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) with these added fields:

- `employeeId` *(required)* — [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
- `department` — [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)

## Depends on

- [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person)
- [onyx-string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/onyx-string)
