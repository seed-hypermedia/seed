---
name: "Example: Folder"
summary: example-folder — an example schema.
schemaDefinition: ipfs://bafyreibf3a5nmtq24ka6nomcuofuv463pnrpwanc4hyloxvqest2sfolne
---
This document describes the **example-folder** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HQsAGrrU -->

# Shape <!-- id:eP9594Lr -->

A **closed struct** with these fields: <!-- id:UieRV9uL -->
  - `name` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:c1M-6Hil -->
  - `files` — list of `link` → [example-file](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-file) <!-- id:si4UGoBD -->
  - `subfolders` — list of `link` → [example-folder](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-folder) <!-- id:Trt0r7XQ -->

# Depends on <!-- id:mTz9ztYz -->

- [example-file](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-file) <!-- id:yY4LjIVc -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:i0I8j29E -->
