---
name: "Example: Folder"
summary: example-folder — an example schema.
schemaDefinition: ipfs://bafyreif3romkmthsl6byqsy4gwta7faudyukt2pscca42ex2ghhq24uimi
---
This document describes the **example-folder** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HQsAGrrU -->

# Shape <!-- id:eP9594Lr -->

A **closed struct** with these fields: <!-- id:UieRV9uL -->
  - `name` _(required)_ — [string](./onyx-string.md) <!-- id:c1M-6Hil -->
  - `files` — list of `link` → [example-file](./example-file.md) <!-- id:si4UGoBD -->
  - `subfolders` — list of `link` → [example-folder](./example-folder.md) <!-- id:Trt0r7XQ -->

# Depends on <!-- id:mTz9ztYz -->

- [example-file](./example-file.md) <!-- id:yY4LjIVc -->
- [string](./onyx-string.md) <!-- id:i0I8j29E -->
