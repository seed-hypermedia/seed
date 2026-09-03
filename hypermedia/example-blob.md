---
name: "Example: Blob"
summary: A binary payload tagged with a MIME type and optional size.
schemaDefinition: ipfs://bafyreihq2dbjvnw3skifjgssdksmhjecjxzg7tpyqvkjeeuqtigehmbv7a
---
This document describes the **example-blob** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:_Qxmk6wX -->

# Shape <!-- id:vesnh_LB -->

A **closed struct** with these fields: <!-- id:v5doVNjp -->
  - `mime` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:MN-579Cf -->
  - `size` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:tB72shxZ -->
  - `data` _(required)_ — [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:Q_T-l5Cr -->

# Depends on <!-- id:CyOF5f4t -->

- [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:X1u_H1kI -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:v3gQbJMy -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:P1GB2FQT -->
