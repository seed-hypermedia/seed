---
name: "Example: Admin"
summary: An employee, extended with a list of permissions.
schemaDefinition: ipfs://bafyreiflahh55m7r2ozkoo2hi42pbxykyjgfdhdu4rdlqthumswwokxw3e
---
This document describes the **example-admin** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:5TfHks-3 -->

# Shape <!-- id:7bCLqs7s -->
**Extends** [example-employee](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-employee) with these added fields: <!-- id:tNotYurF -->
  - `permissions` _(required)_ — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:lrACY6mq -->

# Depends on <!-- id:rrJYZRvC -->
- [example-employee](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-employee) <!-- id:NuTdLmU4 -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HihJcAsQ -->