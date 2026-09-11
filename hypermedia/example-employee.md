---
name: "Example: Employee"
summary: A person, extended with an employee id and department.
schemaDefinition: ipfs://bafyreib46qs6sbs5wohd2j7efkfmfvnxzounamkligghz6jss4t34yyera
---
This document describes the **example-employee** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:xqJ2JASC -->

# Shape <!-- id:FRM7SadU -->

**Extends** [example-person](./example-person.md) with these added fields: <!-- id:XUqvPhRC -->
  - `employeeId` _(required)_ — [string](./hypermedia-string.md) <!-- id:VBcJW2v6 -->
  - `department` — [string](./hypermedia-string.md) <!-- id:LKh9yy5V -->

# Depends on <!-- id:Ah7bnx2c -->

- [example-person](./example-person.md) <!-- id:oci5ofGp -->
- [string](./hypermedia-string.md) <!-- id:qBjztCB9 -->
