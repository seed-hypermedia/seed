---
name: "Example: Filesystem Entry"
summary: "Either a folder or a file, as a union."
schemaDefinition: ipfs://bafyreicnwbbqjk4kpaud45bga7x5y5dzpkcnx66fkausm3hpdmeeiranby
---
A filesystem entry: a [union](../schema/anyof.md) of [folder](./folder.md) and [file](./file.md).

This page describes the **example/entry** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:zrQMizve -->

# Shape <!-- id:OLTnHt0g -->

A **union**. A value matches one of these variants: <!-- id:y2EoSoVb -->
  - [example/folder](./folder.md) <!-- id:pua_KnH- -->
  - [example/file](./file.md) <!-- id:T4GbTWiK -->

# Depends on <!-- id:3_lmgCQY -->

- [example/file](./file.md) <!-- id:oR5BhBVU -->
- [example/folder](./folder.md) <!-- id:zRU3Wyuw -->

# See also

- [folder](./folder.md): one variant.
- [file](./file.md): the other variant.
- [Union](../schema/anyof.md): how `anyOf` works.
- [Examples](../example.md): every example, grouped by feature.
