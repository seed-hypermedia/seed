---
name: "Example: Document"
summary: example-document — an example schema.
schemaDefinition: ipfs://bafyreicqw6ldqav2u3rhlmywfka7l5pfsyk63mykv4wdxcf5zexj6ttzze
---
This document describes the **example-document** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:llTZrE7Q -->

# Shape <!-- id:yS4WhWFT -->
A **closed struct** with these fields: <!-- id:fuIZuu-D -->
  - `title` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:idLG8YKz -->
  - `author` — `link` → [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) <!-- id:ja_Lj9E4 -->
  - `body` — [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:VeUW9ia0 -->
  - `previous` — `link` → [example-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-document) <!-- id:Zlm4QYLV -->

# Depends on <!-- id:WgGKV3_j -->
- [example-person](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person) <!-- id:1pB09QSc -->
- [bytes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/bytes) <!-- id:WFEB7HHQ -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:NfuhhcxV -->