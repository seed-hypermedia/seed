---
name: "Example: Employee"
summary: A person, extended with an employee id and department.
schemaDefinition: ipfs://bafyreibt3wgh55b3vluk4oyswukukcaoeel3cmajjmcahaqtua23orxty4
---
This document describes the **example-employee** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:xqJ2JASC -->

# Shape <!-- id:FRM7SadU -->
**Extends** [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) with these added fields: <!-- id:XUqvPhRC -->
  - `employeeId` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:VBcJW2v6 -->
  - `department` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:LKh9yy5V -->

# Depends on <!-- id:Ah7bnx2c -->
- [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) <!-- id:oci5ofGp -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:qBjztCB9 -->