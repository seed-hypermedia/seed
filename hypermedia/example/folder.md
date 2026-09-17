---
name: "Example: Folder"
summary: example/folder — an example schema.
schemaDefinition: ipfs://bafyreidgzjrbevcoswzdntwlrtxwz5pgvmteq6fgr36vgwx3oojwxvnpfy
---
This document describes the **example/folder** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:HQsAGrrU -->

# Shape <!-- id:eP9594Lr -->

A **closed struct** with these fields: <!-- id:UieRV9uL -->
  - `name` _(required)_: [string](../string.md) <!-- id:c1M-6Hil -->
  - `files`: list of `link` → [example/file](./file.md) <!-- id:si4UGoBD -->
  - `subfolders`: list of `link` → [example/folder](./folder.md) <!-- id:Trt0r7XQ -->

# Depends on <!-- id:mTz9ztYz -->

- [example/file](./file.md) <!-- id:yY4LjIVc -->
- [string](../string.md) <!-- id:i0I8j29E -->
