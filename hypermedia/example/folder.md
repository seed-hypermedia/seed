---
name: "Example: Folder"
summary: A folder with a name and links to its files and subfolders.
schemaDefinition: ipfs://bafyreidgzjrbevcoswzdntwlrtxwz5pgvmteq6fgr36vgwx3oojwxvnpfy
---
A folder with a required `name`, a list of [links](../link.md) to [files](./file.md), and a list of links to subfolders. Folder and file refer to each other, which works because schemas [reference each other by name](../schema/references.md). <!-- id:2TkVV9R7 -->

This page describes the **example/folder** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:HQsAGrrU -->

# Shape <!-- id:eP9594Lr -->

A **closed struct** with these fields: <!-- id:UieRV9uL -->
  - `name` _(required)_: [string](../string.md) <!-- id:c1M-6Hil -->
  - `files`: list of `link` → [example/file](./file.md) <!-- id:si4UGoBD -->
  - `subfolders`: list of `link` → [example/folder](./folder.md) <!-- id:Trt0r7XQ -->

# Depends on <!-- id:mTz9ztYz -->

- [example/file](./file.md) <!-- id:yY4LjIVc -->
- [string](../string.md) <!-- id:i0I8j29E -->

# See also <!-- id:2pL8VNku -->

- [file](./file.md): the other half of the pair. <!-- id:Ssi-4ouk -->
- [entry](./entry.md): a union of the two. <!-- id:0ADCo-JB -->
- [References](../schema/references.md): why mutual recursion works. <!-- id:DaOZaia8 -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:3RnOHU6R -->
