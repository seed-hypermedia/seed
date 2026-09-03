---
name: "Example: Constrained record"
summary: "Exercises the value constraints: string length + pattern, numeric bounds, and list size."
schemaDefinition: ipfs://bafyreihpc62his3wadtc26we7yrxwytojba2wuqoglmoey47ura2w2twga
---
This document describes the **example-constrained** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:7mil43v3 -->

# Shape <!-- id:u0bp8N-O -->
A **closed struct** with these fields: <!-- id:XZkJ0jr0 -->
  - `username` _(required)_ — `string` <!-- id:baxMEaLA -->
  - `score` _(required)_ — `integer` <!-- id:MU1mTe3O -->
  - `tags` — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:mA94BPqd -->

# Depends on <!-- id:OQmAkkji -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:iav6y69T -->